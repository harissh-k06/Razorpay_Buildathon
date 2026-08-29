"use client"

import { create } from "zustand"

export interface AuthUser {
  email: string
  name: string
  picture: string
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  checkAuth: () => Promise<void>
  devLogin: () => Promise<void>
  logout: () => Promise<void>
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  checkAuth: async () => {
    set({ isLoading: true })
    try {
      const res = await fetch(`${API_BASE}/api/auth/status`, {
        credentials: "include",
        cache: "no-store",
      })
      if (!res.ok) {
        set({ user: null, isAuthenticated: false, isLoading: false })
        return
      }
      const data = await res.json()
      if (data.authenticated) {
        // Fetch full user info
        const userRes = await fetch(`${API_BASE}/api/auth/user`, {
          credentials: "include",
          cache: "no-store",
        })
        if (userRes.ok) {
          const user = await userRes.json()
          set({ user, isAuthenticated: true, isLoading: false })
        } else {
          set({ user: null, isAuthenticated: false, isLoading: false })
        }
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false })
      }
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },

  devLogin: async () => {
    set({ isLoading: true })
    try {
      const res = await fetch(`${API_BASE}/api/auth/dev-login`, {
        method: "POST",
        credentials: "include",
      })
      if (res.ok) {
        const data = await res.json()
        set({ user: data.user, isAuthenticated: true, isLoading: false })
        window.location.href = "/dashboard"
      } else {
        set({ isLoading: false })
      }
    } catch {
      set({ isLoading: false })
    }
  },

  logout: async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      })
    } catch {
      // ignore
    }
    set({ user: null, isAuthenticated: false })
    window.location.href = "/sign-in"
  },
}))

