import { rateLimit } from 'express-rate-limit';
import { API_LIMITS } from '../config';

/** A fresh limiter (and counter store) for one router, so unrelated screens do not consume each other's allowance. */
export const apiRateLimit = () => rateLimit(API_LIMITS);
