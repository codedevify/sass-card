require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const paypal = require('@paypal/checkout-server-sdk');
const stripeLib = require('stripe');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware ----------
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// ---------- Cloudinary ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ---------- MongoDB ----------
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

// ---------- Schemas ----------
const productSchema = new mongoose.Schema({
  name: String, desc: String, type: String, icon: String,
  price: Number, image: String, message: String
});
const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
  items: [{ productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, quantity: Number }],
  total: Number,
  customer: { name: String, email: String },
  status: { type: String, default: 'pending' },
  paymentMethod: String,
  paymentIntentId: String,
  paypalOrderId: String,
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

const configSchema = new mongoose.Schema({
  adminPasswordHash: String,
  stripeSecretKey: String,
  stripePublishableKey: String,
  paypalClientId: String,
  paypalClientSecret: String,
  gmailUser: String,
  gmailPass: String
}, { minimize: false });
const Config = mongoose.model('Config', configSchema);

// Multer
const upload = multer({ dest: 'uploads/' });

// ---------- Seed Products ----------
const seedProducts = async () => {
  const count = await Product.countDocuments();
  if (count > 0) return;

  const products = [
    { name: "Llama Birthday Bash", desc: "Colorful llama birthday card.", type: "Birthday", icon: "Llama", price: 4.99, image: "https://via.placeholder.com/400x300?text=Llama+Birthday+Bash", message: "Happy Baaa-thday!" },
    { name: "Thank Ewe Note", desc: "Woolly gratitude card.", type: "Thank You", icon: "Llama", price: 3.49, image: "https://via.placeholder.com/400x300?text=Thank+Ewe+Note", message: "Thank ewe!" },
    // ... (your full 18 products here – same as before)
    { name: "Llama Thank You Party", desc: "Festive thank you.", type: "Thank You", icon: "Llama", price: 3.99, image: "https://via.placeholder.com/400x300?text=Llama+Thank+You+Party", message: "Un-baaa-lievable party!" }
  ];
  await Product.insertMany(products);
  console.log('18 products seeded');
};

mongoose.connection.once('open', () => {
  console.log('Database connected. Seeding products...');
  seedProducts();
});

// ---------- Helper: Get Config + Transporter ----------
let transporter;
const getConfig = () => Config.findOne().lean();
const refreshTransporter = async () => {
  const cfg = await getConfig();
  if (cfg?.gmailUser && cfg?.gmailPass) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: cfg.gmailUser, pass: cfg.gmailPass }
    });
  }
};
refreshTransporter();

// ---------- Routes ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/cart.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cart.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Products
app.get('/api/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

// Cart
app.post('/api/cart/add', (req, res) => {
  const { productId } = req.body;
  if (!req.session.cart) req.session.cart = [];
  const existing = req.session.cart.find(i => i.productId === productId);
  if (existing) existing.quantity += 1;
  else req.session.cart.push({ productId, quantity: 1 });
  res.json({ success: true });
});

app.get('/api/cart', async (req, res) => {
  if (!req.session.cart) return res.json([]);
  const populated = await Promise.all(
    req.session.cart.map(async item => {
      const product = await Product.findById(item.productId);
      return product ? { ...item, product } : null;
    })
  );
  res.json(populated.filter(Boolean));
});

// PayPal
app.get('/api/paypal/config', async (req, res) => {
  const cfg = await getConfig();
  res.json({ clientId: cfg?.paypalClientId || '' });
});

app.post('/api/paypal/create-order', async (req, res) => {
  const { total } = req.body;
  const cfg = await getConfig();
  if (!cfg?.paypalClientId) return res.status(400).json({ error: 'PayPal not configured' });

  const environment = paypal.core.SandboxEnvironment(cfg.paypalClientId, cfg.paypalClientSecret);
  const client = new paypal.core.PayPalHttpClient(environment);
  const request = new paypal.orders.OrdersCreateRequest();
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{ amount: { currency_code: 'USD', value: total.toFixed(2) } }]
  });
  const order = await client.execute(request);
  res.json({ id: order.result.id });
});

app.post('/api/paypal/capture-order', async (req, res) => {
  const { orderID } = req.body;
  const cfg = await getConfig();
  const environment = paypal.core.SandboxEnvironment(cfg.paypalClientId, cfg.paypalClientSecret);
  const client = new paypal.core.PayPalHttpClient(environment);
  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  await client.execute(request);
  res.json({ success: true });
});

// Stripe
app.get('/api/stripe/config', async (req, res) => {
  const cfg = await getConfig();
  res.json({ publishableKey: cfg?.stripePublishableKey || '' });
});

app.post('/api/stripe/create-intent', async (req, res) => {
  const { total } = req.body;
  const cfg = await getConfig();
  if (!cfg?.stripeSecretKey) return res.status(400).json({ error: 'Stripe not configured' });
  const stripe = stripeLib(cfg.stripeSecretKey);
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(total * 100),
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
  });
  res.json({ clientSecret: intent.client_secret });
});

// Finalize Order
app.post('/api/finalize-order', async (req, res) => {
  const { name, email, paymentMethod, paymentIntentId, paypalOrderId } = req.body;
  if (!req.session.cart?.length) return res.status(400).json({ error: 'Cart empty' });

  const items = req.session.cart.map(i => ({ productId: i.productId, quantity: i.quantity }));
  const total = items.reduce((s, i) => s + i.quantity * i.product.price, 0);

  const order = new Order({ items, total, customer: { name, email }, paymentMethod, paymentIntentId, paypalOrderId });
  await order.save();

  // Send emails
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `"Thank Ewe" <${(await getConfig()).gmailUser}>`,
        to: email,
        subject: 'Order Confirmed!',
        html: `<h2>Thank You, ${name}!</h2><p>Your order of $${total.toFixed(2)} is confirmed.</p><p>Order ID: ${order._id}</p>`
      });
      await transporter.sendMail({
        from: `"Thank Ewe" <${(await getConfig()).gmailUser}>`,
        to: (await getConfig()).gmailUser,
        subject: 'NEW ORDER!',
        html: `<h3>New Order from ${name} (${email}) – $${total.toFixed(2)}</h3><p>ID: ${order._id}</p>`
      });
    } catch (e) { console.error('Email failed:', e); }
  }

  req.session.cart = [];
  res.json({ success: true, orderId: order._id });
});

// ---------- Admin Auth ----------
app.post('/admin/login', async (req, res) => {
  const { password } = req.body;
  const cfg = await Config.findOne();
  if (!cfg) {
    if (password.length >= 6) {
      const hash = await bcrypt.hash(password, 10);
      await Config.create({ adminPasswordHash: hash });
      req.session.admin = true;
      return res.json({ success: true, firstTime: true });
    }
    return res.status(400).json({ error: 'Set a password (6+ chars)' });
  }
  const match = await bcrypt.compare(password, cfg.adminPasswordHash);
  if (match) {
    req.session.admin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.post('/admin/change-password', async (req, res) => {
  if (!req.session.admin) return res.status(401).json({ error: 'Unauthorized' });
  const { current, newPass } = req.body;
  const cfg = await Config.findOne();
  const match = await bcrypt.compare(current, cfg.adminPasswordHash);
  if (!match) return res.status(400).json({ error: 'Current password wrong' });
  cfg.adminPasswordHash = await bcrypt.hash(newPass, 10);
  await cfg.save();
  res.json({ success: true });
});

const isAdmin = (req, res, next) => {
  if (req.session.admin) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

// Admin Routes (same as before but with new config fields)
app.get('/api/admin/orders', isAdmin, async (req, res) => {
  const orders = await Order.find().populate('items.productId').sort({ createdAt: -1 });
  res.json(orders);
});
app.put('/api/admin/orders/:id', isAdmin, async (req, res) => {
  await Order.findByIdAndUpdate(req.params.id, { status: req.body.status });
  res.json({ success: true });
});
app.delete('/api/admin/orders/:id', isAdmin, async (req, res) => {
  await Order.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/products', isAdmin, async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

app.post('/api/admin/products', isAdmin, upload.single('image'), async (req, res) => {
  let imageUrl = '';
  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path);
    imageUrl = result.secure_url;
    fs.unlinkSync(req.file.path);
  }
  const product = new Product({ ...req.body, price: parseFloat(req.body.price), image: imageUrl || req.body.image });
  await product.save();
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', isAdmin, async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/config', isAdmin, async (req, res) => {
  const cfg = await getConfig();
  res.json(cfg || {});
});

app.put('/api/admin/config', isAdmin, async (req, res) => {
  await Config.findOneAndUpdate({}, req.body, { upsert: true });
  await refreshTransporter();
  res.json({ success: true });
});
// Add inside server.js
app.post('/api/cart/remove', (req, res) => {
  const { productId } = req.body;
  if (req.session.cart) {
    req.session.cart = req.session.cart.filter(i => i.productId !== productId);
  }
  res.json({ success: true });
});

app.post('/api/cart/clear', (req, res) => {
  req.session.cart = [];
  res.json({ success: true });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
});
