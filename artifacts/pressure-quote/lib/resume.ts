/**
 * A quote waiting on a purchase made from the free-quote limit. After the purchase the paywall
 * closes and the quote screen creates the quote without a second tap. Memory only: if the app
 * restarts, the draft is still saved and one tap creates it.
 */
let pendingJobId: string | null = null;

export function requestResume(jobId: string) {
  pendingJobId = jobId;
}

/** True once for the job that asked; clears the request. */
export function takeResume(jobId: string): boolean {
  if (pendingJobId !== jobId) return false;
  pendingJobId = null;
  return true;
}

export function clearResume() {
  pendingJobId = null;
}
