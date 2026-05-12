import { useState, useEffect } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { updateUserFullName, resetUserPassword, KEYS } from "@/lib/db";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { KeyRound } from "lucide-react";

interface User {
  id: string;
  fullName?: string;
  email?: string;
  role?: string;
}

interface Props { open: boolean; user: User | null; onClose: () => void; }

export function EditUserModal({ open, user, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [fullName, setFullName] = useState("");
  const [password, setPassword]     = useState("");
  const [confirmPw, setConfirmPw]   = useState("");
  const [showPw, setShowPw]         = useState(false);

  useEffect(() => {
    if (user) { setFullName(user.fullName ?? ""); setPassword(""); setConfirmPw(""); setShowPw(false); }
  }, [user]);

  const nameMutation = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => updateUserFullName(id, name) });
  const pwMutation   = useMutation({ mutationFn: ({ id, pw }: { id: string; pw: string }) => resetUserPassword(id, pw) });

  const isPending = nameMutation.isPending || pwMutation.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    if (password && password !== confirmPw) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (password && password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }

    try {
      const ops: Promise<any>[] = [];
      if (fullName.trim() && fullName.trim() !== user.fullName) {
        ops.push(nameMutation.mutateAsync({ id: user.id, name: fullName.trim() }));
      }
      if (password) {
        ops.push(pwMutation.mutateAsync({ id: user.id, pw: password }));
      }
      if (!ops.length) { onClose(); return; }
      await Promise.all(ops);
      await qc.invalidateQueries({ queryKey: KEYS.users() });
      toast({ title: "User updated successfully" });
      onClose();
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Email (cannot be changed)</Label>
            <Input value={user?.email ?? ""} disabled className="opacity-60 cursor-not-allowed" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Role (use the role badge in the table to change)</Label>
            <Input value={user?.role ?? ""} disabled className="opacity-60 cursor-not-allowed" />
          </div>

          <div className="border-t pt-4 space-y-3">
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowPw(v => !v)}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {showPw ? "Hide password reset" : "Reset password"}
            </button>
            {showPw && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>New Password</Label>
                  <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 chars" />
                </div>
                <div className="space-y-1.5">
                  <Label>Confirm</Label>
                  <Input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Repeat password" />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              className="bg-green-700 hover:bg-green-800 text-white"
              disabled={isPending}
            >
              {isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
