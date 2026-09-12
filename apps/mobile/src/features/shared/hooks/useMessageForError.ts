import type { AxiosError } from 'axios';

interface ApiError {
  error?: {
    code?: string;
    message?: string;
  };
}

export function messageForError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Something went wrong. Please try again.';

  const axiosError = error as AxiosError<ApiError>;

  if (!axiosError.response) {
    return 'Unable to connect. Please check your internet connection and try again.';
  }

  const apiError = axiosError.response.data.error;
  if (apiError?.code) {
    switch (apiError.code) {
      case 'RATE_LIMITED':
        return 'Too many requests. Please wait a moment and try again.';
      case 'FORBIDDEN':
        return 'You do not have permission to perform this action.';
      case 'NOT_FOUND':
        return 'The requested resource was not found.';
      case 'CONFLICT':
        return 'This action conflicts with a recent change. Please refresh and try again.';
      default:
        return apiError.message ?? 'Something went wrong. Please try again.';
    }
  }

  return 'Something went wrong. Please try again.';
}
