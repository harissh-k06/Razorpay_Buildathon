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
    // 1. Check if session_id is in URL query parameters from Google OAuth redirect
    if (typeof window !== "undefined") {
      try {
        const urlParams = new URLSearchParams(window.location.search)
        const querySessionId = urlParams.get("session_id")
        if (querySessionId) {
          localStorage.setItem("pw_session_id", querySessionId)
          // Clean up URL query param without refreshing
          const newUrl = window.location.pathname
          window.history.replaceState({}, document.title, newUrl)
        }
      } catch {}
    }

    // 2. Check local storage cache for instant hydration
    let storedUser: AuthUser | null = null
    let storedSessionId: string | null = null
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("pw_user")
        if (raw) storedUser = JSON.parse(raw)
        storedSessionId = localStorage.getItem("pw_session_id")
      } catch {}
    }

    if (storedUser) {
      set({ user: storedUser, isAuthenticated: true, isLoading: false })
    }

    // 3. Verify / refresh with backend API
    try {
      const headers: Record<string, string> = {}
      if (storedSessionId) {
        headers["Authorization"] = `Bearer ${storedSessionId}`
        headers["x-session-id"] = storedSessionId
      }

      const res = await fetch(`${API_BASE}/api/auth/status`, {
        credentials: "include",
        headers,
        cache: "no-store",
      })

      if (res.ok) {
        const data = await res.json()
        if (data.authenticated) {
          const userRes = await fetch(`${API_BASE}/api/auth/user`, {
            credentials: "include",
            headers,
            cache: "no-store",
          })
          if (userRes.ok) {
            const user = await userRes.json()
            if (typeof window !== "undefined") {
              localStorage.setItem("pw_user", JSON.stringify(user))
            }
            set({ user, isAuthenticated: true, isLoading: false })
            return
          }
        }
      }

      // If backend says unauthenticated and no stored user
      if (!storedUser) {
        set({ user: null, isAuthenticated: false, isLoading: false })
      }
    } catch {
      // Offline / network failure fallback
      if (!storedUser) {
        set({ user: null, isAuthenticated: false, isLoading: false })
      }
    }
  },

  devLogin: async () => {
    set({ isLoading: true })
    const demoUser: AuthUser = {
      email: "admin@pennywise.finance",
      name: "Demo Admin",
      picture: "https://api.dicebear.com/7.x/avataaars/svg?seed=PennyWise",
    }
    
    // Store locally immediately
    if (typeof window !== "undefined") {
      localStorage.setItem("pw_user", JSON.stringify(demoUser))
      localStorage.setItem("pw_session_id", "demo-session-token")
    }
    set({ user: demoUser, isAuthenticated: true, isLoading: false })

    try {
      const res = await fetch(`${API_BASE}/api/auth/dev-login`, {
        method: "POST",
        credentials: "include",
      })
      if (res.ok) {
        const data = await res.json()
        if (data.session_id && typeof window !== "undefined") {
          localStorage.setItem("pw_session_id", data.session_id)
        }
      }
    } catch {}

    window.location.href = "/reconciliation/upload"
  },

  logout: async () => {
    if (typeof window !== "undefined") {
      const sessionId = localStorage.getItem("pw_session_id")
      try {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          credentials: "include",
          headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
        })
      } catch {}
      localStorage.removeItem("pw_user")
      localStorage.removeItem("pw_session_id")
    }
    set({ user: null, isAuthenticated: false })
    window.location.href = "/sign-in"
  },
}))

