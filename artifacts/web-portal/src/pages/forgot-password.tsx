import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Leaf, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setMessage("");

    const redirectTo = new URL(
      "/reset-password",
      window.location.origin,
    ).toString();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo },
    );

    if (resetError) {
      setError(
        resetError.message ||
          "We could not send the reset email. Please try again.",
      );
    } else {
      // Keep the response neutral so the form does not reveal registered accounts.
      setMessage(
        "If an account exists for that email, a password-reset link has been sent.",
      );
    }
    setIsLoading(false);
  };

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-12 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-10 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-700">
            <Leaf className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-bold">Invendis</span>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <Mail className="mb-4 h-8 w-8 text-green-700" />
          <h1 className="text-2xl font-bold tracking-tight">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your account email and we’ll send you a secure reset link.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="recovery-email">Email</Label>
              <Input
                id="recovery-email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setError("");
                }}
                autoComplete="email"
                required
              />
            </div>
            {error && (
              <p
                role="alert"
                className="text-sm text-red-700 dark:text-red-300"
              >
                {error}
              </p>
            )}
            {message && (
              <p
                role="status"
                className="text-sm text-green-700 dark:text-green-300"
              >
                {message}
              </p>
            )}
            <Button
              type="submit"
              className="w-full bg-green-700 hover:bg-green-800"
              disabled={isLoading || !email.trim()}
            >
              {isLoading ? "Sending…" : "Send reset link"}
            </Button>
          </form>

          <Link
            href="/login"
            className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-green-700 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
