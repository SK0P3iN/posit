import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import {
  AuthServiceBff,
  SESSION_COOKIE,
} from '@gitroom/saas-bff/auth/auth.service';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly authService: AuthServiceBff) {}

  use(req: Request, res: Response, next: NextFunction) {
    const token =
      req.cookies?.[SESSION_COOKIE] ||
      (req.headers['saas_session'] as string | undefined);

    const user = this.authService.resolveSession(token);
    if (!user) {
      throw new UnauthorizedException();
    }

    req.saasUser = user;
    next();
  }
}

@Injectable()
export class OptionalAuthMiddleware implements NestMiddleware {
  constructor(private readonly authService: AuthServiceBff) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const token =
      req.cookies?.[SESSION_COOKIE] ||
      (req.headers['saas_session'] as string | undefined);
    const user = this.authService.resolveSession(token);
    if (user) {
      req.saasUser = user;
    }
    next();
  }
}
