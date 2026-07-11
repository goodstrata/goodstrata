import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface AuthPageInfo {
  socialProviders?: string[];
}

/** Runtime auth capabilities shared by sign-in, sign-up and Security. */
export function useAuthPageInfo() {
  return useQuery({
    queryKey: ["auth-page-info"],
    queryFn: () => api<AuthPageInfo>("/api/demo-info"),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}
