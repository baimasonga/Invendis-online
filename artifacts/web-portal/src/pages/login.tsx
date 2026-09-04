import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Link, Redirect } from "wouter";
import { Leaf, Wheat, Truck, ClipboardCheck } from "lucide-react";

export default function Login() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const { login, isAuthenticated } = useAuth();
  const { toast } = useToast();

  if (isAuthenticated) return <Redirect to="/dashboard" />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoginError("");
    setIsLoading(true);
    try {
      await login({ email, password });
    } catch (error: any) {
      const message = error.message || "Invalid email or password.";
      setLoginError(message);
      toast({ title: "Login failed", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    { icon: Wheat, text: "Farmer registry & verification" },
    { icon: Truck, text: "Vehicle dispatch & GPS tracking" },
    { icon: ClipboardCheck, text: "Proof of delivery capture" },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Left branding panel */}
      <div className="hidden lg:flex w-[46%] flex-col justify-between p-12 relative overflow-hidden"
           style={{ background: "linear-gradient(160deg, #14532d 0%, #166534 45%, #15803d 100%)" }}>
        {/* Decorative circles */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute top-1/3 -right-20 w-64 h-64 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-20 left-1/4 w-72 h-72 rounded-full bg-white/5 pointer-events-none" />

        {/* Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
            <Leaf className="h-5 w-5 text-white" />
          </div>
          <span className="text-white font-bold text-xl tracking-tight">Invendis</span>
        </div>

        {/* Main copy */}
        <div className="relative z-10">
          <h2 className="text-white text-3xl font-bold leading-tight mb-4">
            From field<br />to farmer.
          </h2>
          <p className="text-green-200/80 text-base mb-10 leading-relaxed max-w-xs">
            End-to-end visibility over agricultural input distribution across Sierra Leone.
          </p>
          <div className="space-y-3">
            {features.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                  <Icon className="h-3.5 w-3.5 text-green-200" />
                </div>
                <span className="text-green-100/90 text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom stats */}
        <div className="grid grid-cols-3 gap-3 relative z-10">
          {[
            { value: "Live", label: "Operations" },
            { value: "14", label: "Districts" },
            { value: "4", label: "Warehouses" },
          ].map(({ value, label }) => (
            <div key={label} className="bg-white/10 rounded-xl p-3 text-center">
              <div className="text-white font-bold text-lg leading-none">{value}</div>
              <div className="text-green-200/70 text-xs mt-1">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-zinc-950 p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-green-700 flex items-center justify-center">
              <Leaf className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-lg">Invendis</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Welcome back</h1>
            <p className="text-muted-foreground mt-1 text-sm">Sign in to your account to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setLoginError(""); }}
                className="h-10"
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                <Link href="/forgot-password" className="text-xs font-medium text-green-700 hover:text-green-800 hover:underline">
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setLoginError(""); }}
                className="h-10"
                required
                autoComplete="current-password"
              />
            </div>
            {loginError && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {loginError}
              </p>
            )}
            <Button
              type="submit"
              className="w-full h-10 bg-green-700 hover:bg-green-800 text-white font-medium"
              disabled={isLoading}
            >
              {isLoading ? "Signing in…" : "Sign In"}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Invendis Field Operations System &nbsp;·&nbsp; Sierra Leone
          </p>
        </div>
      </div>
    </div>
  );
}
