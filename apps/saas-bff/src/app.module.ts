import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { AuthController } from '@gitroom/saas-bff/auth/auth.controller';
import { AuthServiceBff } from '@gitroom/saas-bff/auth/auth.service';
import { AuthMiddleware } from '@gitroom/saas-bff/auth/auth.middleware';
import { UserStore } from '@gitroom/saas-bff/users/user.store';
import { PostizClient } from '@gitroom/saas-bff/postiz/postiz.client';
import { HealthController } from '@gitroom/saas-bff/health/health.controller';
import { PostizProxyController } from '@gitroom/saas-bff/postiz/postiz.proxy.controller';

@Module({
  controllers: [AuthController, HealthController, PostizProxyController],
  providers: [AuthServiceBff, UserStore, PostizClient],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .exclude(
        { path: 'auth/register', method: RequestMethod.POST },
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'auth/logout', method: RequestMethod.POST },
        { path: 'health', method: RequestMethod.GET },
        { path: 'health/postiz', method: RequestMethod.GET }
      )
      .forRoutes('*');
  }
}
