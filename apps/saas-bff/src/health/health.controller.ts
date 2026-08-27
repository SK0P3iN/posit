import { Controller, Get } from '@nestjs/common';
import { PostizClient } from '@gitroom/saas-bff/postiz/postiz.client';

@Controller('/health')
export class HealthController {
  constructor(private readonly postizClient: PostizClient) {}

  @Get()
  health() {
    return { ok: true, service: 'saas-bff' };
  }

  @Get('/postiz')
  async postiz() {
    const reachable = await this.postizClient.probeConnectivity();
    return {
      ok: reachable,
      postizBackendUrl: this.postizClient.getBaseUrl(),
    };
  }
}
