"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addOrderToPaymentProfile = addOrderToPaymentProfile;
exports.removeOrderFromPaymentProfile = removeOrderFromPaymentProfile;
exports.updatePaymentProfileWithOrder = updatePaymentProfileWithOrder;
const express_1 = __importDefault(require("express"));
const dotenv_1 = require("dotenv");
const airaloService_1 = require("./services/airaloService");
const solanaService_1 = require("./services/solanaService");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
// Initialize Firebase Admin SDK
const firebaseDatabaseUrl = process.env.FIREBASE_DB_URL || "";
if (firebase_admin_1.default.apps.length === 0) {
    const serviceAccount = require("../esim-a3042-firebase-adminsdk-fbsvc-09dcd371d1.json");
    firebase_admin_1.default.initializeApp({
        credential: firebase_admin_1.default.credential.cert(serviceAccount),
        databaseURL: firebaseDatabaseUrl,
    });
}
const db = firebase_admin_1.default.database();
const app = (0, express_1.default)();
app.use(express_1.default.json());
(0, dotenv_1.config)();
const solanaService = new solanaService_1.SolanaService();
const esimService = new airaloService_1.EsimService();
try {
    esimService.connectToFirebase();
}
catch (error) {
    console.log('Error connecting to firebase:', error);
}
function addOrderToPaymentProfile(ppPublicKey, orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const paymentProfileRef = db.ref(`/payment_profiles/${ppPublicKey}`);
            const paymentProfileSnapshot = yield paymentProfileRef.once('value');
            const currentPaymentProfileData = paymentProfileSnapshot.val() || {};
            let orderIds = currentPaymentProfileData.orderIds || [];
            if (!orderIds.includes(orderId)) { // Prevent duplicates
                orderIds.push(orderId);
            }
            yield paymentProfileRef.update({ orderIds, updatedAt: new Date().toISOString() });
        }
        catch (error) {
            console.error('Error updating payment profile with order:', error);
            throw error;
        }
    });
}
function removeOrderFromPaymentProfile(ppPublicKey, orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const paymentProfileRef = db.ref(`/payment_profiles/${ppPublicKey}`);
            const paymentProfileSnapshot = yield paymentProfileRef.once('value');
            const currentPaymentProfileData = paymentProfileSnapshot.val() || {};
            let orderIds = currentPaymentProfileData.orderIds || [];
            const updatedOrderIds = orderIds.filter(id => id !== orderId);
            yield paymentProfileRef.update({ orderIds: updatedOrderIds, updatedAt: new Date().toISOString() });
        }
        catch (error) {
            console.error('Error removing order from payment profile:', error);
            // Depending on your error handling, you might want to log and continue
        }
    });
}
const authenticateUser = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Expect "Bearer <token>"
    if (!token) {
        return res.status(401).json({ message: 'Authentication token required' });
    }
    jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        const decodedPayload = decoded;
        const userId = decodedPayload.publicKey || decodedPayload.userId;
        if (!userId) {
            return res.status(403).json({ message: 'Could not extract user ID from token' });
        }
        req.authenticatedUserId = userId;
        next(); // Go to next middleware
    });
};
// User must have payment profile as unique identifier to manage payment and esim subcription
app.post('/create-payment-profile', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { publicKey, privateKey } = yield solanaService.createNewSolanaWallet();
        const paymentProfile = {
            publicKey,
            privateKey,
            createdAt: '',
            updatedAt: ''
        };
        yield db.ref(`/payment_profiles/${publicKey}`).set(paymentProfile);
        res.status(201).json({ publicKey });
    }
    catch (error) {
        console.error("Error creating payment profile:", error);
        res.status(500).json({ error: "Failed to create payment profile" });
    }
}));
function updatePaymentProfileWithOrder(ppPublicKey, orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const paymentProfileRef = db.ref(`/payment_profiles/${ppPublicKey}`);
            const paymentProfileSnapshot = yield paymentProfileRef.once('value');
            const currentPaymentProfileData = paymentProfileSnapshot.val() || {};
            let orderIds = currentPaymentProfileData.orderIds || [];
            orderIds.push(orderId);
            yield paymentProfileRef.update({ orderIds });
        }
        catch (error) {
            console.error('Error updating payment profile with order:', error);
            throw error;
        }
    });
}
app.post('/order', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const orderId = (0, uuid_1.v4)();
    console.log(orderId); // Generate a unique order ID containing 20 characters
    const { ppPublicKey, quantity, package_id, package_price } = req.body;
    // Check if the payment profile exists
    const paymentProfileSnapshot = yield db.ref(`/payment_profiles/${ppPublicKey}`).once('value');
    if (!paymentProfileSnapshot.exists()) {
        return res.status(400).json({ error: 'payment profile not found' });
    }
    const order = {
        orderId,
        ppPublicKey,
        quantity,
        package_id,
        package_price,
        paymentReceived: false,
        paidToMaster: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending',
    };
    yield db.ref(`/orders/${orderId}`).set(order);
    yield addOrderToPaymentProfile(ppPublicKey, orderId);
    const paymentCheckDuration = 600000; // 10 minutes
    const pollingInterval = 30000; // Poll every 10 seconds
    const startTime = Date.now();
    const paymentCheckInterval = setInterval(() => __awaiter(void 0, void 0, void 0, function* () {
        // Check if the total duration has passed
        if (Date.now() - startTime > paymentCheckDuration) {
            console.log(`Payment check duration exceeded for order ${orderId}. Stopping polling.`);
            clearInterval(paymentCheckInterval);
            const latestOrderSnapshot = yield db.ref(`/orders/${orderId}`).once('value');
            const latestOrder = latestOrderSnapshot.val();
            if (latestOrder && !latestOrder.paymentReceived) {
                yield db.ref(`/orders/${orderId}`).update({ status: 'failed', updatedAt: new Date().toISOString() });
            }
            return;
        }
        const currentOrderSnapshot = yield db.ref(`/orders/${orderId}`).once('value');
        const currentOrder = currentOrderSnapshot.val();
        // If order doesn't exist or is already paid/processed, stop polling
        if (!currentOrder || currentOrder.paymentReceived) {
            clearInterval(paymentCheckInterval);
            return;
        }
        try {
            // Check if payment was received
            const { enoughReceived, solBalance } = yield solanaService.checkSolanaPayment(order.ppPublicKey, order.package_price);
            order.paymentInSol = solBalance;
            console.log(`processing order ${order.orderId}`, enoughReceived, solBalance);
            if (enoughReceived) {
                console.log(`Payment received for order ${orderId}.`);
                clearInterval(paymentCheckInterval);
                // Retrieve the latest order data before updating
                const latestOrderSnapshot = yield db.ref(`/orders/${orderId}`).once('value');
                const latestOrder = latestOrderSnapshot.val();
                // Only proceed if payment hasn't been processed by another check instance (unlikely but good practice)
                if (!latestOrder.paymentReceived) {
                    latestOrder.paymentReceived = true;
                    latestOrder.updatedAt = new Date().toISOString(); // Update timestamp
                    latestOrder.status = 'paid'; // Update status
                    const sim = yield esimService.placeOrder({ quantity, package_id });
                    latestOrder.sim = sim;
                    yield db.ref(`/orders/${orderId}`).set(latestOrder);
                    yield updatePaymentProfileWithOrder(ppPublicKey, orderId);
                }
                // handle aggregation of payment to master wallet
                // should handle failed case 
                if (latestOrder.paymentReceived) {
                    const privateKey = paymentProfileSnapshot.val().privateKey;
                    const sig = yield solanaService.aggregatePaymentToMasterWallet(privateKey, parseFloat(order.package_price));
                    if (sig) {
                        latestOrder.paidToMaster = true;
                        latestOrder.updatedAt = new Date().toISOString(); // Update timestamp
                        latestOrder.status = 'paid_to_master'; // Update status
                        yield db.ref(`/orders/${orderId}`).set(latestOrder);
                    }
                    else {
                        console.error(`Failed to aggregate payment to master wallet for order ${orderId}.`);
                        latestOrder.updatedAt = new Date().toISOString(); // Update timestamp
                        latestOrder.status = 'failed'; // Update status
                        yield db.ref(`/orders/${orderId}`).set(latestOrder);
                    }
                }
            }
        }
        catch (error) {
            console.error(`Error processing order payment for order ${orderId}:`, error);
            // Depending on error handling requirements, you might want to stop the interval here
            clearInterval(paymentCheckInterval);
            // Optionally update order status to failed here as well
            const latestOrderSnapshot = yield db.ref(`/orders/${orderId}`).once('value');
            const latestOrder = latestOrderSnapshot.val();
            latestOrder.updatedAt = new Date().toISOString(); // Update timestamp
            latestOrder.status = 'failed'; // Update status
            yield db.ref(`/orders/${orderId}`).set(latestOrder);
        }
    }), pollingInterval);
    res.json({ orderId });
}));
// to be routinely called by front-end to check if order has been fulfilled
app.get('/order/:orderId', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { orderId } = req.params;
    const orderSnapshot = yield db.ref(`/orders/${orderId}`).once('value');
    const order = orderSnapshot.val();
    if (!orderSnapshot.exists()) {
        res.status(404).json({ message: 'Order not found' });
    }
    if (order.paymentReceived && order.sim.iccid) {
        res.json({
            orderId: order.orderId,
            paymentReceived: order.paymentReceived,
            sim: order.sim
        });
    }
    else {
        res.status(204).send(); // Send a 204 status with no body
    }
}));
// GET handler to get packages from getPackagePlans()
app.get('/packages', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { type, country } = req.query;
        if (!type) {
            return res.status(400).json({ error: 'Missing required parameters: type' });
        }
        // Cast type to the expected union type, assuming valid input based on validation above
        const packageType = type;
        const packages = yield esimService.getPackagePlans(packageType, country);
        if (packages === undefined) {
            // This case is handled in the service by returning undefined on error
            return res.status(500).json({ error: 'Failed to retrieve package plans' });
        }
        res.json(packages);
    }
    catch (error) {
        console.error("Error in /packages endpoint:", error);
        res.status(500).json({ error: "Failed to retrieve package plans" });
    }
}));
// Health check endpoint
app.get('/health', (req, res) => {
    res.send("OK");
});
const port = parseInt(process.env.PORT || '3000');
app.listen(port, () => {
    console.log(`listening on port ${port}`);
});
//# sourceMappingURL=index.js.map