export interface PaymentProfile {
  publicKey: string;
  privateKey: string;
}

export interface MarkSimInstalledBody {
  installed: boolean;
  iccid: string;
  id: string;
}

export interface CompleteOrderBody {
  orders: any[];
  id: string;
}

export interface CacheBody {
  value: any;
  ttl?: number;
}

export interface ErrorLogBody {
  message: string;
}
