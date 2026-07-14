import { useEffect, useState, useCallback } from "react";
import { UserPlus, Trash, FloppyDisk } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import api, { apiError } from "@/lib/api";
import { MastersPanel } from "@/components/settings/MastersPanel";
import { SystemStatusPanel } from "@/components/settings/SystemStatusPanel";

const EMPTY_USER = { username: "", name: "", password: "", role: "dispatch" };

export default function Settings() {
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState(EMPTY_USER);
  const [deleteUser, setDeleteUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [logs, setLogs] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(() => api.get("/admin/users").then((r) => setUsers(r.data)).catch(() => {}), []);
  const loadLogs = useCallback(() => api.get("/admin/logs").then((r) => setLogs(r.data)).catch(() => {}), []);

  useEffect(() => {
    loadUsers();
    loadLogs();
    api.get("/admin/company-profile").then((r) => setProfile(r.data)).catch(() => {});
  }, [loadUsers, loadLogs]);

  const createUser = async () => {
    setSaving(true);
    try {
      await api.post("/admin/users", newUser);
      toast.success(`User ${newUser.username} created`);
      setNewUser(EMPTY_USER);
      loadUsers();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteUser = async () => {
    try {
      await api.delete(`/admin/users/${deleteUser.id}`);
      toast.success(`User ${deleteUser.username} deleted`);
      setDeleteUser(null);
      loadUsers();
    } catch (err) {
      toast.error(apiError(err));
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.put("/admin/company-profile", profile);
      toast.success(profile.published ? "Company profile published to landing page" : "Company profile saved (unpublished)");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const setP = (k) => (e) => setProfile({ ...profile, [k]: e.target.value });

  return (
    <div className="max-w-5xl space-y-8" data-testid="settings-page">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-primary mb-2">Administration</p>
        <h1 className="text-3xl font-black tracking-tight">Settings</h1>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="rounded-sm bg-secondary">
          <TabsTrigger value="users" className="rounded-sm" data-testid="tab-users">User Management</TabsTrigger>
          <TabsTrigger value="profile" className="rounded-sm" data-testid="tab-company-profile">Company Profile</TabsTrigger>
          <TabsTrigger value="logs" className="rounded-sm" data-testid="tab-audit-logs">Audit Logs</TabsTrigger>
          <TabsTrigger value="masters" className="rounded-sm" data-testid="tab-masters">Masters</TabsTrigger>
          <TabsTrigger value="system" className="rounded-sm" data-testid="tab-system">System Status</TabsTrigger>
        </TabsList>

        <TabsContent value="masters" className="mt-6">
          <MastersPanel />
        </TabsContent>

        <TabsContent value="system" className="mt-6">
          <SystemStatusPanel />
        </TabsContent>

        <TabsContent value="users" className="space-y-6 mt-6">
          <div className="border border-border bg-card rounded-sm p-6 space-y-4" data-testid="create-user-form">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
              <UserPlus size={14} className="text-primary" /> Add New User
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Username</Label>
                <Input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} data-testid="new-user-username-input" className="rounded-sm bg-input h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Full Name</Label>
                <Input value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} data-testid="new-user-name-input" className="rounded-sm bg-input h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Password</Label>
                <Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} data-testid="new-user-password-input" className="rounded-sm bg-input h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Role</Label>
                <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v })}>
                  <SelectTrigger className="rounded-sm bg-input h-9" data-testid="new-user-role-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="dispatch">Dispatch</SelectItem>
                    <SelectItem value="admin">Administrator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button size="sm" onClick={createUser} disabled={saving || !newUser.username || !newUser.password || !newUser.name} data-testid="create-user-button" className="rounded-sm active:scale-95 transition-transform">
              {saving ? "Creating..." : "Create User"}
            </Button>
          </div>

          <div className="border border-border rounded-sm overflow-x-auto bg-card">
            <Table data-testid="users-table">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  {["Username", "Name", "Role", "Created", "Actions"].map((h) => (
                    <TableHead key={h} className="text-[10px] uppercase tracking-[0.15em]">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} className="border-border hover:bg-secondary/50" data-testid={`user-row-${u.username}`}>
                    <TableCell className="font-mono">{u.username}</TableCell>
                    <TableCell>{u.name}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="rounded-sm text-[10px] uppercase tracking-widest">
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.created_at?.slice(0, 10)}</TableCell>
                    <TableCell>
                      <button
                        onClick={() => setDeleteUser(u)}
                        className="p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                        data-testid={`delete-user-${u.username}`}
                        aria-label="Delete user"
                      >
                        <Trash size={16} />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="profile" className="mt-6">
          {profile && (
            <div className="border border-border bg-card rounded-sm p-6 space-y-5" data-testid="company-profile-form">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Company Profile — shown on landing page once published</p>
                <div className="flex items-center gap-3">
                  <Label htmlFor="publish-switch" className="text-sm">Publish to website</Label>
                  <Switch
                    id="publish-switch"
                    checked={profile.published}
                    onCheckedChange={(v) => setProfile({ ...profile, published: v })}
                    data-testid="publish-profile-switch"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Company Introduction</Label>
                  <Textarea value={profile.introduction} onChange={setP("introduction")} data-testid="profile-introduction-input" className="rounded-sm bg-input min-h-[90px]" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Vision</Label>
                  <Textarea value={profile.vision} onChange={setP("vision")} data-testid="profile-vision-input" className="rounded-sm bg-input" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Mission</Label>
                  <Textarea value={profile.mission} onChange={setP("mission")} data-testid="profile-mission-input" className="rounded-sm bg-input" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Products</Label>
                  <Textarea value={profile.products} onChange={setP("products")} data-testid="profile-products-input" className="rounded-sm bg-input" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Services</Label>
                  <Textarea value={profile.services} onChange={setP("services")} data-testid="profile-services-input" className="rounded-sm bg-input" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Contact Email</Label>
                  <Input value={profile.contact_email} onChange={setP("contact_email")} data-testid="profile-email-input" className="rounded-sm bg-input h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Contact Phone</Label>
                  <Input value={profile.contact_phone} onChange={setP("contact_phone")} data-testid="profile-phone-input" className="rounded-sm bg-input h-9" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Address</Label>
                  <Input value={profile.address} onChange={setP("address")} data-testid="profile-address-input" className="rounded-sm bg-input h-9" />
                </div>
              </div>
              <Button onClick={saveProfile} disabled={saving} data-testid="save-profile-button" className="rounded-sm gap-2 active:scale-95 transition-transform">
                <FloppyDisk size={16} weight="bold" /> {saving ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-6">
          <div className="border border-border rounded-sm overflow-x-auto bg-card">
            <Table data-testid="audit-logs-table">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  {["Timestamp", "User", "Action", "Category", "Details"].map((h) => (
                    <TableHead key={h} className="text-[10px] uppercase tracking-[0.15em]">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-10">No activity logged yet.</TableCell>
                  </TableRow>
                ) : (
                  logs.map((l, i) => (
                    <TableRow key={i} className="border-border hover:bg-secondary/50">
                      <TableCell className="font-mono text-xs whitespace-nowrap">{l.timestamp?.slice(0, 19).replace("T", " ")}</TableCell>
                      <TableCell className="font-mono text-xs">{l.username}</TableCell>
                      <TableCell className="text-xs">{l.action}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-sm text-[10px] uppercase">{l.category}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{l.details}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!deleteUser} onOpenChange={(o) => !o && setDeleteUser(null)}>
        <AlertDialogContent className="bg-card border-border" data-testid="delete-user-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user "{deleteUser?.username}"?</AlertDialogTitle>
            <AlertDialogDescription>This user will lose all access to the portal immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-sm">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteUser} data-testid="confirm-delete-user-button" className="rounded-sm bg-red-600 hover:bg-red-500 text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
