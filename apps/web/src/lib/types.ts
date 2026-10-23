export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: 'CUSTOMER' | 'ASSISTANT' | 'BUSINESS_STAFF' | 'ADMIN';
  emailVerified: boolean;
  createdAt: string;
}
