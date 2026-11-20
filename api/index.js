import { createHandler } from '../server/app.js';
// No listener, filesystem writes, or process-local database in a Vercel Function.
export default createHandler();
