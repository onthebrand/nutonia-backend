import MercadoPagoSDK from 'mercadopago';
import { env } from './env.js';

// @ts-ignore - MercadoPago SDK type issues
const mercadopago = new MercadoPagoSDK.MercadoPagoConfig({
    accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
});

export const mercadopagoClient = mercadopago;

export default mercadopago;
