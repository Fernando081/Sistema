import { HttpContextToken } from '@angular/common/http';

// A screen may present request errors next to its controls. Authentication
// failures still expire the session through the global interceptor.
export const LOCAL_ERROR_FEEDBACK = new HttpContextToken<boolean>(() => false);
