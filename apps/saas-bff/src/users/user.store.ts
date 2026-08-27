import { Injectable, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { SaasUserRecord } from '@gitroom/saas-bff/auth/auth.types';

@Injectable()
export class UserStore implements OnModuleInit {
  private filePath: string;
  private users = new Map<string, SaasUserRecord>();
  private emailIndex = new Map<string, string>();

  async onModuleInit() {
    const dataDir =
      process.env.SAAS_DATA_DIR ||
      join(process.cwd(), 'var', 'saas-bff');
    this.filePath = join(dataDir, 'users.json');
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    await this.load();
  }

  private async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const list = JSON.parse(raw) as SaasUserRecord[];
      this.users.clear();
      this.emailIndex.clear();
      for (const user of list) {
        this.users.set(user.id, user);
        this.emailIndex.set(user.email.toLowerCase(), user.id);
      }
    } catch {
      this.users.clear();
      this.emailIndex.clear();
    }
  }

  private async persist() {
    const list = Array.from(this.users.values());
    await fs.writeFile(this.filePath, JSON.stringify(list, null, 2), 'utf8');
  }

  findByEmail(email: string) {
    const id = this.emailIndex.get(email.toLowerCase());
    return id ? this.users.get(id) : undefined;
  }

  findById(id: string) {
    return this.users.get(id);
  }

  async create(user: SaasUserRecord) {
    if (this.emailIndex.has(user.email.toLowerCase())) {
      throw new Error('EMAIL_EXISTS');
    }
    this.users.set(user.id, user);
    this.emailIndex.set(user.email.toLowerCase(), user.id);
    await this.persist();
    return user;
  }
}
