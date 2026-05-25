const express = require('express');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

// CORS Configuration - Allow frontend to communicate
const corsOptions = {
  origin: ['https://mangodirect.in', 'http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-password', 'X-Admin-Password'],
  exposedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200,
  preflightContinue: false
};

app.use(cors(corsOptions));

// Explicit OPTIONS handler for preflight requests
app.options('*', cors(corsOptions));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
console.log('📊 MongoDB URI configured:', MONGODB_URI ? '✅ Yes' : '❌ No');

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB error:', err.message);
});

// Razorpay Setup
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

console.log('💳 Razorpay Key ID:', RAZORPAY_KEY_ID ? '✅ Set' : '❌ Missing');
console.log('🔐 Razorpay Key Secret:', RAZORPAY_KEY_SECRET ? '✅ Set' : '❌ Missing');
console.log('🔑 Admin Password:', ADMIN_PASSWORD ? '✅ Set' : '❌ Missing');

// Admin Authentication Middleware
const adminAuth = (req, res, next) => {
  const pwd = req.headers['x-admin-password'];
  if (pwd !== ADMIN_PASSWORD) {
    console.error('❌ Invalid admin password attempt');
    return res.status(401).json({ error: 'Unauthorized - Invalid admin password' });
  }
  next();
};

let razorpay;
try {
  razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
  });
  console.log('🥭 Razorpay initialized successfully');
} catch (err) {
  console.error('❌ Razorpay initialization error:', err.message);
}

// MongoDB Schemas
const OrderSchema = new mongoose.Schema({
  id: String,
  orderId: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  name: String,
  email: String,
  phone: String,
  items: Array,
  total: Number,
  subtotal: Number,
  discount: Number,
  couponCode: String,
  paymentStatus: { type: String, default: 'pending' },
  orderStatus: { type: String, default: 'pending' },
  address: String,
  city: String,
  state: String,
  zipCode: String,
  awb: String,
  notes: String,
  statusHistory: Array,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const CustomerSchema = new mongoose.Schema({
  email: String,
  name: String,
  phone: String,
  totalOrders: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  lastOrder: Date,
  createdAt: { type: Date, default: Date.now }
});

const CouponSchema = new mongoose.Schema({
  code: String,
  discount: Number,
  discountType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
  maxUses: Number,
  used: { type: Number, default: 0 },
  expiryDate: Date,
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const ProductSchema = new mongoose.Schema({
  id: String,
  name: String,
  price: Number,
  mrp: Number,
  description: String,
  weight: String,
  gallery: Array,
  stock: { type: Number, default: 0 },
  sku: String,
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', OrderSchema);
const Customer = mongoose.model('Customer', CustomerSchema);
const Coupon = mongoose.model('Coupon', CouponSchema);
const Product = mongoose.model('Product', ProductSchema);

// ═══════════════════════════════════════════
// HEALTH CHECK ENDPOINTS (No auth needed)
// ═══════════════════════════════════════════

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Mango Direct Backend Running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is online', timestamp: new Date() });
});

// ═══════════════════════════════════════════
// PAYMENT ENDPOINTS
// ═══════════════════════════════════════════

// Create Razorpay Order
app.post('/api/payment/create-order', async (req, res) => {
  try {
    const { amount, customerEmail, customerPhone, cartItems } = req.body;
    
    console.log('\n=== Payment Order Request ===');
    console.log('Amount:', amount);
    console.log('Email:', customerEmail);
    console.log('Phone:', customerPhone);
    
    if (!amount || amount <= 0) {
      console.error('❌ Invalid amount:', amount);
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!razorpay) {
      console.error('❌ Razorpay not initialized');
      return res.status(500).json({ error: 'Razorpay not configured' });
    }

    console.log(`💳 Creating Razorpay order for amount: ${amount} paise (₹${amount/100})`);
    
    const orderPayload = {
      amount: Math.round(amount),
      currency: 'INR',
      receipt: `MD${Date.now()}`,
      notes: { 
        email: customerEmail, 
        phone: customerPhone,
        items: cartItems ? cartItems.length : 0
      }
    };
    
    console.log('Order payload:', JSON.stringify(orderPayload, null, 2));
    
    const order = await razorpay.orders.create(orderPayload);

    console.log(`✅ Razorpay order created: ${order.id}`);

    const response = {
      success: true,
      orderId: order.id,
      razorpayOrderId: order.id,
      keyId: RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency
    };
    
    console.log('📤 Sending response to frontend:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    console.error('\n=== ERROR Creating Order ===');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error status:', error.statusCode);
    
    res.status(500).json({ 
      error: 'Failed to create order',
      message: error.message,
      code: error.code
    });
  }
});

// Verify Payment
app.post('/api/payment/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      console.error('❌ Signature mismatch');
      return res.status(400).json({ error: 'Signature mismatch' });
    }

    console.log('✅ Payment verified:', razorpay_payment_id);
    res.json({ success: true, paymentId: razorpay_payment_id });

  } catch (error) {
    console.error('❌ Error verifying payment:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════
// ADMIN PROTECTED ROUTES
// ═══════════════════════════════════════════

// ORDER ENDPOINTS
app.get('/api/orders/stats', adminAuth, async (req, res) => {
  try {
    const total = await Order.countDocuments();
    const pending = await Order.countDocuments({ orderStatus: 'pending' });
    const processing = await Order.countDocuments({ orderStatus: 'processing' });
    const dispatched = await Order.countDocuments({ orderStatus: 'dispatched' });
    const delivered = await Order.countDocuments({ orderStatus: 'delivered' });
    
    res.json({ 
      stats: { 
        total, 
        pending, 
        processing, 
        dispatched, 
        delivered 
      } 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders', adminAuth, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ orders: orders });
  } catch (error) {
    console.error('❌ Error fetching orders:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/orders/:id', adminAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    let orderData = req.body;
    
    // Safely convert string numbers to actual numbers
    try {
      if (orderData.total && typeof orderData.total === 'string') {
        orderData.total = parseFloat(String(orderData.total).replace(/[^0-9.-]/g, '')) || 0;
      }
      if (orderData.subtotal && typeof orderData.subtotal === 'string') {
        orderData.subtotal = parseFloat(String(orderData.subtotal).replace(/[^0-9.-]/g, '')) || 0;
      }
      if (orderData.discount && typeof orderData.discount === 'string') {
        orderData.discount = parseFloat(String(orderData.discount).replace(/[^0-9.-]/g, '')) || 0;
      }
    } catch (convErr) {
      console.warn('⚠️ Number conversion warning:', convErr.message);
    }
    
    // Ensure items array exists
    if (!orderData.items || !Array.isArray(orderData.items)) {
      orderData.items = [];
    }
    
    const order = new Order(orderData);
    await order.save();
    console.log('✅ Order saved:', order._id);
    res.json({ success: true, orderId: order._id });
  } catch (error) {
    console.error('❌ Error saving order:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/orders/:id', adminAuth, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/orders/:id', adminAuth, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CUSTOMER ENDPOINTS
app.get('/api/customers', adminAuth, async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/customers', adminAuth, async (req, res) => {
  try {
    const customer = new Customer(req.body);
    await customer.save();
    res.json({ success: true, customer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// COUPON ENDPOINTS
app.get('/api/coupons', adminAuth, async (req, res) => {
  try {
    const coupons = await Coupon.find();
    res.json(coupons);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/coupons', adminAuth, async (req, res) => {
  try {
    const coupon = new Coupon(req.body);
    await coupon.save();
    res.json({ success: true, coupon });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/coupons/:id', adminAuth, async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, coupon });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/coupons/:id', adminAuth, async (req, res) => {
  try {
    await Coupon.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ VALIDATE COUPON CODE (Customer Checkout - No Admin Auth Needed)
app.post('/api/coupons/validate', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code || code.trim() === '') {
      return res.status(400).json({ error: 'Coupon code required' });
    }

    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    
    if (!coupon) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    if (!coupon.active) {
      return res.status(400).json({ error: 'Coupon is inactive' });
    }

    if (coupon.expiryDate && new Date(coupon.expiryDate) < new Date()) {
      return res.status(400).json({ error: 'Coupon has expired' });
    }

    if (coupon.maxUses && coupon.used >= coupon.maxUses) {
      return res.status(400).json({ error: 'Coupon has reached max uses' });
    }

    console.log(`✅ Coupon validated: ${code} - Discount: ${coupon.discount}${coupon.discountType === 'percentage' ? '%' : '₹'}`);

    return res.json({ 
      success: true, 
      discount: coupon.discount,
      discountType: coupon.discountType // 'percentage' or 'fixed'
    });

  } catch (error) {
    console.error('❌ Coupon validation error:', error.message);
    res.status(500).json({ error: 'Server error validating coupon' });
  }
});

// PRODUCT ENDPOINTS
app.get('/api/products', adminAuth, async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', adminAuth, async (req, res) => {
  try {
    const product = new Product(req.body);
    await product.save();
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/products/:id', adminAuth, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', adminAuth, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ANALYTICS ENDPOINTS
app.get('/api/analytics', adminAuth, async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();
    const totalRevenue = await Order.aggregate([
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);
    
    const totalCustomers = await Customer.countDocuments();
    
    const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(10);
    
    res.json({
      totalOrders,
      totalRevenue: totalRevenue[0]?.total || 0,
      totalCustomers,
      recentOrders
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// INVENTORY ENDPOINTS
app.get('/api/inventory', adminAuth, async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/inventory/:id', adminAuth, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, { stock: req.body.stock }, { new: true });
    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADMIN SETTINGS ENDPOINTS
app.get('/api/settings', adminAuth, (req, res) => {
  res.json({
    adminPasswordSet: !!ADMIN_PASSWORD,
    razorpayConfigured: !!RAZORPAY_KEY_ID,
    mongodbConnected: mongoose.connection.readyState === 1
  });
});

// ═══════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ═══════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ All endpoints ready:');
  console.log('   • /api/health - Health check (no auth)');
  console.log('   • /api/orders - Order management (admin)');
  console.log('   • /api/customers - Customer data (admin)');
  console.log('   • /api/coupons - Coupon management (admin)');
  console.log('   • /api/coupons/validate - Coupon validation (no auth) ✨ NEW');
  console.log('   • /api/products - Product management (admin)');
  console.log('   • /api/inventory - Stock management (admin)');
  console.log('   • /api/analytics - Analytics data (admin)');
  console.log('   • /api/payment/* - Payment processing (no auth)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
