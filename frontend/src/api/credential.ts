import { get, post, put, del } from './request';
import type {
  PaginatedData,
  Credential,
  CredentialType,
  RepositoryCredentialLoan,
} from '@/types';

export interface CredentialListParams {
  keyword?: string;
  cred_type?: CredentialType;
  scope?: string;
  project?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export const credentialApi = {
  getCredentials: (params?: CredentialListParams) =>
    get<PaginatedData<Credential>>('/credentials/', { params }),
  getCredential: (id: string) => get<Credential>(`/credentials/${id}/`),
  createCredential: (data: Partial<Credential>) => post<Credential>('/credentials/', data),
  updateCredential: (id: string, data: Partial<Credential>) =>
    put<Credential>(`/credentials/${id}/`, data),
  deleteCredential: (id: string) => del<null>(`/credentials/${id}/`),
  testCredential: (id: string) =>
    post<{ valid: boolean; detail?: string }>(`/credentials/${id}/test/`, {}),
  getUsage: (id: string, params?: { page?: number; page_size?: number }) =>
    get<PaginatedData<unknown>>(`/credentials/${id}/usage/`, { params }),
  getTypes: () => get<{ value: CredentialType; label: string }[]>('/credentials/types/'),
  getLoans: (params?: Record<string, unknown>) =>
    get<PaginatedData<RepositoryCredentialLoan>>('/credentials/loans/', { params }),
  getAvailableLoans: (repository: string, product: string, operation = 'read') =>
    get<RepositoryCredentialLoan[]>('/credentials/loans/available/', {
      params: { repository, product, operation },
    }),
  createLoan: (data: Partial<RepositoryCredentialLoan>) =>
    post<RepositoryCredentialLoan>('/credentials/loans/', data),
  updateLoan: (id: string, data: Partial<RepositoryCredentialLoan>) =>
    put<RepositoryCredentialLoan>(`/credentials/loans/${id}/`, data),
  revokeLoan: (id: string) =>
    post<RepositoryCredentialLoan>(`/credentials/loans/${id}/revoke/`, {}),
};
