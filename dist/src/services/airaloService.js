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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EsimService = void 0;
const dotenv_1 = require("dotenv");
const airalo_api_1 = require("@montarist/airalo-api");
(0, dotenv_1.config)();
class EsimService {
    constructor(db) {
        this.db = db; // Receive the initialized db instance
        const clientId = process.env.AIRALO_CLIENT_ID;
        const clientSecret = process.env.AIRALO_CLIENT_SECRET;
        const clientUrl = process.env.AIRALO_CLIENT_URL;
        if (!clientId) {
            throw new Error("AIRALO_CLIENT_ID environment variable is not set.");
        }
        if (!clientSecret) {
            throw new Error("AIRALO_CLIENT_SECRET environment variable is not set.");
        }
        this.airaloService = new airalo_api_1.AiraloService({
            baseUrl: clientUrl,
            clientId,
            clientSecret
        });
    }
    // Removed the connectToFirebase method
    placeOrder(orderDetails) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield this.airaloService.createOrder({
                    package_id: orderDetails.package_id,
                    quantity: orderDetails.quantity,
                    type: "sim",
                });
                console.log('eSim buy response: ', response);
                const data_json = JSON.stringify(response);
                const parsed_sim = JSON.parse(data_json);
                const sims = parsed_sim.data.sims;
                const sim = sims[0];
                console.log('received sims: ', sims);
                return {
                    iccid: sim.iccid,
                    qrcode: sim.qrcode,
                    qrcode_url: sim.qrcode_url,
                    created_at: sim.created_at,
                    direct_apple_installation_url: sim.direct_apple_installation_url
                };
            }
            catch (error) {
                console.error("Error placing Airalo order:", error);
                throw new Error(error.message);
            }
        });
    }
    getPackagePlans(type, country) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const cacheKey = `package-plans/${type}/${country || 'global'}`;
                const cachedData = yield this.db.ref(cacheKey).once('value');
                const cacheEntry = cachedData.val();
                const now = Date.now();
                const twentyFourHoursInMillis = 24 * 60 * 60 * 1000;
                if (cacheEntry && cacheEntry.timestamp && (now - cacheEntry.timestamp < twentyFourHoursInMillis)) {
                    console.log("Returning cached data for", cacheKey);
                    return cacheEntry.data;
                }
                console.log("Fetching data from Airalo API for", cacheKey);
                const packages = yield this.airaloService.getPackages({
                    type,
                    country
                });
                // parsing information
                let cleanedPackageData = [];
                for (const item of packages.data) {
                    let newObj = {};
                    const data_json = JSON.stringify(item);
                    const parsed_item = JSON.parse(data_json);
                    newObj["region"] = parsed_item.slug;
                    newObj["operators"] = [];
                    for (const operator of parsed_item.operators) {
                        const newOperator = {};
                        newOperator["id"] = operator.id;
                        newOperator["title"] = operator.title;
                        newOperator["packages"] = [];
                        for (const packageItem of operator.packages) {
                            newOperator["packages"].push({
                                id: packageItem.id,
                                price: packageItem.price,
                                day: packageItem.day,
                                data: packageItem.data
                            });
                        }
                        newObj["operators"].push(newOperator);
                    }
                    console.log(newObj);
                    cleanedPackageData.push(newObj);
                }
                console.log(cleanedPackageData);
                // Cache the fetched data with a timestamp
                yield this.db.ref(cacheKey).set({ data: cleanedPackageData, timestamp: now });
                console.log("Cached data to Firebase for", cacheKey);
                return cleanedPackageData;
            }
            catch (error) {
                console.error("Error getting package plans:", error);
                throw new Error(error.message);
            }
        });
    }
}
exports.EsimService = EsimService;
//# sourceMappingURL=airaloService.js.map