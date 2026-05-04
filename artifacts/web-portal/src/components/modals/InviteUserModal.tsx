import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateUser, getListUsersQueryKey } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const ROLES = ["Admin", "ProjectManager", "DistrictCoordinator", "WarehouseManager", "FieldOfficer", "Viewer"];

interface Props { open: boolean; onClose: () => void; }

export function InviteUserModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createUser = useCreateUser();

  const [fullName, setFullName]   = useState("");
  const [username, setUsername]   = useState("");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [role, setRole]           = useState("");

  function reset() { setFullName(""); setUsername(""); setEmail(""); setPassword(""); setRole(""); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName || !username || !password || !role) return;
    try {
      await createUser.mutateAsync({
        data: { fullName, username, email: email || undefined, password, role, isActive: true } as any,
      });
      await qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      toast({ title: "User created", description: `${fullName} (${role}) can now sign in.` });
      reset();
      onClose();
    } catch (err: any) {
      toast({ title: "Failed to create user", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create User Account</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>Full Name *</Label>
              <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Aminata Koroma" required />
            </div>
            <div className="space-y-1.5">
              <Label>Username *</Label>
              <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="a.koroma" required />
            </div>
            <div className="space-y-1.5">
              <Label>Role *</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue placeholder="Select role…" /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="a.koroma@example.com" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Password *</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Temporary password" required />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button
              type="submit"
              className="bg-green-700 hover:bg-green-800 text-white"
              disabled={createUser.isPending || !fullName || !username || !password || !role}
            >
              {createUser.isPending ? "Creating…" : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
