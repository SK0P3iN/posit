import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  AuthServiceBff,
  SESSION_COOKIE,
} from '@gitroom/saas-bff/auth/auth.service';

class RegisterDto {
  email: string;
  password: string;
  name?: string;
}

class LoginDto {
  email: string;
  password: string;
}

@Controller('/auth')
export class AuthController {
  constructor(private readonly authService: AuthServiceBff) {}

  @Post('/register')
  async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) response: Response
  ) {
    const user = await this.authService.register(
      body.email,
      body.password,
      body.name
    );
    this.authService.setSessionCookie(response, {
      userId: user.id,
      email: user.email,
    });
    return user;
  }

  @Post('/login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response
  ) {
    const user = this.authService.login(body.email, body.password);
    this.authService.setSessionCookie(response, {
      userId: user.id,
      email: user.email,
    });
    return user;
  }

  @Post('/logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response) {
    this.authService.clearSessionCookie(response);
    return { success: true };
  }

  @Get('/me')
  me(@Req() request: Request) {
    if (!request.saasUser) {
      throw new UnauthorizedException();
    }
    return this.authService.me(request.saasUser);
  }
}

export { SESSION_COOKIE };
