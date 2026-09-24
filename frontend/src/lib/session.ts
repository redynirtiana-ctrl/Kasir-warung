import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import type { User } from "@/lib/types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<User>("/v1/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}

export async function login(username: string, password: string): Promise<User> {
  const user = await apiPost<User>("/v1/auth/login", { username, password });
  queryClient.clear();
  queryClient.setQueryData(["me"], user);
  return user;
}

export async function logout(): Promise<void> {
  await apiPost("/v1/auth/logout").catch(() => undefined);
  queryClient.clear();
}
