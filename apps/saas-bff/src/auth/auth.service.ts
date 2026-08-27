import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { UserStore } from '@gitroom/saas-bff/users/user.store';
import { PostizClient } from '@gitroom/saas-bff/postiz/postiz.client';
import {
  SaasRequestUser,
  SaasSessionPayload,
} from '@gitroom/saas-bff/auth/auth.types';

const SESSION_COOKIE = 'saas_session';
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;

@Injectable()
export class AuthServiceBff {
  constructor(
    private readonly userStore: UserStore,
    private readonly postizClient: PostizClient
  ) {}

  private sessionCookieOptions() {
    const secure = !process.env.NOT_SECURED;
    return {
      httpOnly: true,
      secure,
      sameSite: secure ? ('none' as const) : ('lax' as const),
      maxAge: SESSION_MS,
      path: '/',
    };
  }

  setSessionCookie(response: Response, payload: SaasSessionPayload) {
    const token = AuthService.signJWT({ ...payload, saas: true });
    response.cookie(SESSION_COOKIE, token, this.sessionCookieOptions());
    if (process.env.NOT_SECURED) {
      response.header('saas_session', token);
    }
  }

  clearSessionCookie(response: Response) {
    response.clearCookie(SESSION_COOKIE, this.sessionCookieOptions());
  }

  resolveSession(token?: string): SaasRequestUser | null {
    if (!token) {
      return null;
    }
    try {
      const payload = AuthService.verifyJWT(token) as SaasSessionPayload & {
        saas?: boolean;
      };
      if (!payload?.saas || !payload.userId) {
        return null;
      }
      const user = this.userStore.findById(payload.userId);
      if (!user) {
        return null;
      }
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        postizOrgId: user.postizOrgId,
        postizApiKey: user.postizApiKey,
      };
    } catch {
      return null;
    }
  }

  async register(email: string, password: string, name: string) {
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }
    if (this.userStore.findByEmail(email)) {
      throw new ConflictException('Email already registered');
    }

    const id = makeId(16);
    const postizUser = await this.postizClient.createEnterpriseUser({
      id,
      name: name || email.split('@')[0],
      email,
    });

    const record = {
      id,
      email: email.toLowerCase(),
      name: name || email.split('@')[0],
      passwordHash: AuthService.hashPassword(password),
      postizOrgId: postizUser.id,
      postizApiKey: postizUser.apiKey,
      createdAt: new Date().toISOString(),
    };

    await this.userStore.create(record);

    return {
      id: record.id,
      email: record.email,
      name: record.name,
      postizOrgId: record.postizOrgId,
    };
  }

  login(email: string, password: string) {
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }
    const user = this.userStore.findByEmail(email);
    if (!user || !AuthService.comparePassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      postizOrgId: user.postizOrgId,
    };
  }

  me(user: SaasRequestUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      postizOrgId: user.postizOrgId,
    };
  }
}

export { SESSION_COOKIE };
