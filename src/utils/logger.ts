import pino from 'pino';
import { config } from '../config/env';

const logger = pino({
  level: config.NODE_ENV === 'development' ? 'debug' : 'info'
});

export default logger;
