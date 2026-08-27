import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

export interface CreatePostizUserInput {
  id: string;
  name: string;
  email: string;
}

export interface CreatePostizUserResult {
  id: string;
  apiKey: string;
}

@Injectable()
export class PostizClient implements OnModuleInit {
  private readonly logger = new Logger(PostizClient.name);
  private baseUrl = '';

  onModuleInit() {
    this.baseUrl = (process.env.POSTIZ_BACKEND_URL || '').replace(/\/$/, '');
    if (!this.baseUrl) {
      throw new Error(
        'POSTIZ_BACKEND_URL is required for saas-bff (e.g. http://localhost:3000)'
      );
    }
    this.logger.log(`Postiz backend: ${this.baseUrl}`);
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  async probeConnectivity() {
    const response = await fetch(this.baseUrl, { method: 'GET' });
    return response.ok || response.status < 500;
  }

  async createEnterpriseUser(input: CreatePostizUserInput) {
    const saasName = process.env.SAAS_NAME || 'mobile-saas';
    const params = AuthService.signJWT({
      id: input.id,
      name: input.name,
      saasName,
      email: input.email,
    });

    const response = await fetch(`${this.baseUrl}/enterprise/create-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ params }),
    });

    const body = (await response.json()) as
      | CreatePostizUserResult
      | { create?: false; success?: false };

    if (!response.ok || !body || !('id' in body) || !body.apiKey) {
      throw new Error('POSTIZ_PROVISION_FAILED');
    }

    return body;
  }

  async request(
    apiKey: string,
    method: string,
    path: string,
    body?: unknown
  ) {
    const url = `${this.baseUrl}/public/v1${path.startsWith('/') ? path : `/${path}`}`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: apiKey,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return { status: response.status, body: payload };
  }
}
