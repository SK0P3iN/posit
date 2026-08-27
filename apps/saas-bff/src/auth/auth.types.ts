export interface SaasUserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  postizOrgId: string;
  postizApiKey: string;
  createdAt: string;
}

export interface SaasSessionPayload {
  userId: string;
  email: string;
}

export interface SaasRequestUser {
  id: string;
  email: string;
  name: string;
  postizOrgId: string;
  postizApiKey: string;
}

declare global {
  namespace Express {
    interface Request {
      saasUser?: SaasRequestUser;
    }
  }
}

export {};
