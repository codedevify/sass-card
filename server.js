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
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware ----------
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecretkey123',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 60 * 60 * 1000 }
}));

// ---------- Cloudinary ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ---------- MongoDB ----------
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// ---------- Schemas ----------
const productSchema = new mongoose.Schema({
  name: String, desc: String, type: String, icon: String,
  price: Number, image: String, message: String
});
const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
  sessionId: String,
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
  paypalClientId: String,
  paypalClientSecret: String,
  stripePublishableKey: String,
  stripeSecretKey: String
});
const Config = mongoose.model('Config', configSchema);

// ---------- Multer ----------
const upload = multer({ dest: 'uploads/' });

// ---------- Nodemailer ----------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

transporter.verify((error) => {
  if (error) console.error('Email error:', error);
  else console.log('Email ready');
});

// ---------- Seed Products ----------
const seedProducts = async () => {
  if (await Product.countDocuments()) return;
  const products = [
    { name: "Llama Birthday Bash", desc: "Colorful llama birthday card.", type: "Birthday", icon: "Llama", price: 4.99, image: "https://via.placeholder.com/400x300?text=Llama+Birthday+Bash", message: "Happy Baaa-thday!" },
    { name: "Thank Ewe Note", desc: "Woolly gratitude card.", type: "Thank You", icon: "Llama", price: 3.49, image: "https://via.placeholder.com/400x300?text=Thank+Ewe+Note", message: "Thank ewe!" },
    { name: "Llama Anniversary", desc: "Romantic llama card.", type: "Special Occasion", icon: "Llama", price: 5.99, image: "https://via.placeholder.com/400x300?text=Llama+Anniversary", message: "Llama-zing love!" },
    { name: "Get Well Llama", desc: "Cheerful recovery card.", type: "Special Occasion", icon: "Llama", price: 3.99, image: "https://via.placeholder.com/400x300?text=Get+Well+Llama", message: "Woolly recovery!" },
    { name: "Llama Congratulations", desc: "Festive celebration card.", type: "Special Occasion", icon: "Llama", price: 4.49, image: "https://via.placeholder.com/400x300?text=Llama+Congratulations", message: "Llama-tastic!" },
    { name: "Llama Sympathy", desc: "Gentle sympathy card.", type: "Special Occasion", icon: "Llama", price: 3.99, image: "https://via.placeholder.com/400x300?text=Llama+Sympathy", message: "Woolly hugs." },
    { name: "Llama Holiday Cheer", desc: "Festive holiday card.", type: "Special Occasion", icon: "Llama", price: 4.29, image: "https://via.placeholder.com/400x300?text=Llama+Holiday+Cheer", message: "Woolly wishes!" },
    { name: "Baby Llama Bliss", desc: "New baby congratulations.", type: "Special Occasion", icon: "Llama", price: 4.79, image: "https://via.placeholder.com/400x300?text=Baby+Llama+Bliss", message: "Little llama!" },
    { name: "Llama Wedding Wishes", desc: "Elegant wedding card.", type: "Special Occasion", icon: "Llama", price: 5.49, image: "https://via.placeholder.com/400x300?text=Llama+Wedding+Wishes", message: "Forever llama-zing!" },
    { name: "Llama Graduation", desc: "Academic success card.", type: "Special Occasion", icon: "Llama", price: 4.69, image: "https://via.placeholder.com/400x300?text=Llama+Graduation", message: "Woolly brilliant!" },
    { name: "Llama Friendship", desc: "Heartfelt friendship card.", type: "Special Occasion", icon: "Llama", price: 3.89, image: "https://via.placeholder.com/400x300?text=Llama+Friendship", message: "Shear-iously awesome!" },
    { name: "Llama New Home", desc: "New home welcome.", type: "Special Occasion", icon: "Llama", price: 4.39, image: "https://via.placeholder.com/400x300?text=Llama+New+Home", message: "Woolly new home!" },
    { name: "Llama Birthday Fiesta", desc: "Vibrant birthday party.", type: "Birthday", icon: "Llama", price: 4.89, image: "https://via.placeholder.com/400x300?text=Llama+Birthday+Fiesta", message: "Llama-tastic bash!" },
    { name: "Thank Ewe Kindness", desc: "Gratitude for kindness.", type: "Thank You", icon: "Llama", price: 3.59, image: "https://via.placeholder.com/400x300?text=Thank+Ewe+Kindness", message: "Shear perfection!" },
    { name: "Llama Retirement", desc: "Retirement celebration.", type: "Special Occasion", icon: "Llama", price: 4.99, image: "https://via.placeholder.com/400x300?text=Llama+Retirement", message: "Woolly retirement!" },
    { name: "Llama Baby Shower", desc: "Expecting parents card.", type: "Special Occasion", icon: "Llama", price: 4.59, image: "https://via.placeholder.com/400x300?text=Llama+Baby+Shower", message: "Little llama coming!" },
    { name: "Llama Encouragement", desc: "Uplifting encouragement.", type: "Special Occasion", icon: "Llama", price: 3.79, image: "https://via.placeholder.com/400x300?text=Llama+Encouragement", message: "Shine, woolly star!" },
    { name: "Llama Thank You Party", desc: "Festive thank you.", type: "Thank You", icon: "Llama", price: 3.99, image: "https://via.placeholder.com/400x300?text=Llama+Thank+You+Party", message: "Un-baaa-lievable party!" }
  ];
  await Product.insertMany(products);
  console.log('18 products seeded');
};
seedProducts();

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

// ---------- PAYPAL ----------
app.get('/api/paypal/config', async (req, res) => {
  const config = await Config.findOne() || {};
  res.json({ clientId: config.paypalClientId });
});

app.post('/api/paypal/create-order', async (req, res) => {
  const { total } = req.body;
  const config = await Config.findOne();
  if (!config?.paypalClientId) return res.status(400).json({ error: 'PayPal not configured' });

  const environment = new paypal.core.SandboxEnvironment(config.paypalClientId, config.paypalClientSecret);
  const client = new paypal.core.PayPalHttpClient(environment);
  const request = new paypal.orders.OrdersCreateRequest();
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{ amount: { currency_code: 'USD', value: total.toFixed(2) } }]
  });
  try {
    const order = await client.execute(request);
    res.json({ id: order.result.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  const { orderID } = req.body;
  const config = await Config.findOne();
  const environment = new paypal.core.SandboxEnvironment(config.paypalClientId, config.paypalClientSecret);
  const client = new paypal.core.PayPalHttpClient(environment);
  const request = new paypal.orders.OrdersCaptureRequest(orderID);
  try {
    const capture = await client.execute(request);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- STRIPE ----------
app.get('/api/stripe/config', async (req, res) => {
  const config = await Config.findOne() || {};
  res.json({ publishableKey: config.stripePublishableKey });
});

app.post('/api/stripe/create-intent', async (req, res) => {
  const { total } = req.body;
  const config = await Config.findOne();
  if (!config?.stripeSecretKey) return res.status(400).json({ error: 'Stripe not configured' });
  const stripe = stripeLib(config.stripeSecretKey);
  try {
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
    });
    res.json({ clientSecret: intent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- FINALIZE ORDER ----------
app.post('/api/finalize-order', async (req, res) => {
  const { name, email, paymentMethod, paymentIntentId, paypalOrderId } = req.body;
  if (!req.session.cart?.length) return res.status(400).json({ error: 'Cart empty' });

  const total = req.session.cart.reduce((s, i) => s + i.quantity * i.product.price, 0);
  const items = req.session.cart.map(i => ({ productId: i.productId, quantity: i.quantity }));

  const order = new Order({ sessionId: req.sessionID, items, total, customer: { name, email }, paymentMethod, paymentIntentId, paypalOrderId });
  await order.save();

  // ---------- SEND EMAILS ----------
  const mailOptions = {
    from: `"Thank Ewe" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Order Confirmed!',
    html: `<h2>Thank You, ${name}!</h2><p>Your order of <strong>$${total.toFixed(2)}</strong> is confirmed.</p><p>Order ID: <code>${order._id}</code></p>`
  };

  const adminMail = {
    from: `"Thank Ewe" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: 'NEW ORDER!',
    html: `<h3>New Order</h3><p>From: ${name} (${email})</p><p>Total: $${total.toFixed(2)}</p><p>ID: ${order._id}</p>`
  };

  try {
    await transporter.sendMail(mailOptions);
    await transporter.sendMail(adminMail);
    console.log('Emails sent');
  } catch (err) {
    console.error('Email failed:', err);
  }

  req.session.cart = [];
  res.json({ success: true, orderId: order._id });
});

// ---------- Admin ----------
app.post('/admin/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.admin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

const isAdmin = (req, res, next) => {
  if (req.session.admin) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

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
  let imageUrl = req.body.image || '';
  if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path);
    imageUrl = result.secure_url;
    fs.unlinkSync(req.file.path);
  }
  const product = new Product({ ...req.body, price: parseFloat(req.body.price), image: imageUrl });
  await product.save();
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', isAdmin, async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/config', isAdmin, async (req, res) => {
  const cfg = await Config.findOne() || {};
  res.json(cfg);
});

app.put('/api/admin/config', isAdmin, async (req, res) => {
  await Config.findOneAndUpdate({}, req.body, { upsert: true });
  res.json({ success: true });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin.html (pass: ${process.env.ADMIN_PASSWORD})`);
});