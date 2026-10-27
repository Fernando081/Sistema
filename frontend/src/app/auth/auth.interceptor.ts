import { HttpInterceptorFn } from '@angular/common/http';
import { isApiUrl } from '../shared/api-url';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiUrl(req.url)) {
    return next(req);
  }

  const path=new URL(req.url,window.location.origin).pathname;
  const portal=path==='/api/v1/portal'||path.startsWith('/api/v1/portal/');
  const authReq = req.clone({
    withCredentials: true,
    setHeaders: portal?{ 'X-Portal-Browser': '1' }:{ 'X-ERP-Browser': '1' },
  });

  return next(authReq);
};
