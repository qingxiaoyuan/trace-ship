import { get, post, del } from './request';
import type { PaginatedData, Feedback } from '@/types';

export interface CreateFeedbackParams {
  title: string;
  content: string;
  category: string;
}

export const feedbackApi = {
  getFeedbacks: (params?: Record<string, unknown>) =>
    get<PaginatedData<Feedback>>('/feedback/', { params }),
  createFeedback: (data: CreateFeedbackParams) => post<Feedback>('/feedback/', data),
  toggleLike: (id: string) => post<{ liked: boolean; like_count: number }>(`/feedback/${id}/like/`, {}),
  processFeedback: (id: string) => post<Feedback>(`/feedback/${id}/process/`, {}),
  deleteFeedback: (id: string) => del<null>(`/feedback/${id}/`),
};
