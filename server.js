const express = require('express');
const mongoose = require('mongoose');
const Razorpay = require('razorpay');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

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

console.log('💳 Razorpay Key ID:', RAZORPAY_KEY_ID ? '✅ Set' : '❌ Missing');
console.log('🔐 Razorpay Key Secret:', RAZORPAY_KEY_SECRET ? '✅ Set' : '❌ Missing');

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

// MongoDB Schema
const OrderSchema = new mongoose.Schema({
  orderId: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  customerName: String,
  customerEmail: String,
  customerPhone: String,
  items: Array,
  total: Number,
  paymentStatus: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', OrderSchema);

// Routes
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Mango Direct Backend Running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

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
    console.log('Order details:', JSON.stringify(order, null, 2));

    res.json({
      success: true,
      orderId: order.id,
      razorpayOrderId: order.id,
      keyId: RAZORPAY_KEY_ID,
      amount: order.amount,
      currency: order.currency
    });

  } catch (error) {
    console.error('\n=== ERROR Creating Order ===');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error status:', error.statusCode);
    if (error.response) {
      console.error('Response status:', error.response.statusCode);
      console.error('Response body:', error.response.body);
    }
    console.error('Full error:', error);
    
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

// Save Order
app.post('/api/orders', async (req, res) => {
  try {
    const order = new Order(req.body);
    await order.save();
    console.log('✅ Order saved:', order._id);
    res.json({ success: true, orderId: order._id });
  } catch (error) {
    console.error('❌ Error saving order:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get Orders
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find();
    res.json(orders);
  } catch (error) {
    console.error('❌ Error fetching orders:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Start Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Ready to accept payment requests! 💰');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
