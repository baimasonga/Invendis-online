import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Leaf } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setHasRecoverySession(Boolean(data.session));
        setIsChecking(false);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && mounted) {
        setHasRecoverySession(Boolean(session));
        setIsChecking(false);
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must contain at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setIsLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError)
      setError(updateError.message || "Password could not be updated.");
    else setComplete(true);
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
          {complete ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-700" />
              <h1 className="mt-4 text-2xl font-bold">Password updated</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                You can now sign in with your new password.
              </p>
              <Button
                asChild
                className="mt-6 w-full bg-green-700 hover:bg-green-800"
              >
                <Link href="/login">Return to sign in</Link>
              </Button>
            </div>
          ) : isChecking ? (
            <p className="text-sm text-muted-foreground">
              Checking reset link…
            </p>
          ) : !hasRecoverySession ? (
            <div className="text-center">
              <h1 className="text-xl font-bold">Reset link unavailable</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This link is invalid or has expired. Request a new one to
                continue.
              </p>
              <Button asChild variant="outline" className="mt-6 w-full">
                <Link href="/forgot-password">Request another link</Link>
              </Button>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold tracking-tight">
                Choose a new password
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Use at least 8 characters.
              </p>
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
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
                <Button
                  type="submit"
                  className="w-full bg-green-700 hover:bg-green-800"
                  disabled={isLoading}
                >
                  {isLoading ? "Updating…" : "Update password"}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
