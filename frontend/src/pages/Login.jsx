import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Wrench, Lock, User as UserIcon, ArrowLeft } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { apiError } from "@/lib/api";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(username.trim(), password);
      toast.success(`Welcome back, ${user.name}`);
      navigate("/portal");
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col lg:flex-row" data-testid="login-page">
      <div className="hidden lg:flex flex-col justify-between w-[42%] border-r border-border bg-card p-12">
        <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="login-back-link">
          <ArrowLeft size={16} /> Back to site
        </Link>
        <div>
          <div className="w-14 h-14 bg-primary flex items-center justify-center rounded-sm mb-8">
            <Wrench size={32} weight="bold" className="text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-black tracking-tight leading-tight">
            Grewal
            <br />
            Engineering
            <br />
            <span className="text-primary">Works</span>
          </h1>
          <p className="text-primary text-sm uppercase tracking-[0.25em] mt-4 font-semibold">TAFE Vendor Automation Portal</p>
          <p className="text-muted-foreground mt-4 leading-relaxed max-w-sm">
            Central automation portal — dispatch, packing, ASN, E-Way bills and quality management in one secure platform.
          </p>
        </div>
        <div className="hazard-stripe h-1.5 w-40 rounded-sm" aria-hidden="true" />
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md rise-in">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-sm">
              <Wrench size={22} weight="bold" className="text-primary-foreground" />
            </div>
            <p className="font-black tracking-tight">GREWAL ENGINEERING WORKS</p>
          </div>
          <p className="lg:hidden text-[10px] uppercase tracking-[0.25em] text-primary -mt-7 mb-8">TAFE Vendor Automation Portal</p>
          <p className="text-xs uppercase tracking-[0.3em] text-primary mb-3">Secure Access</p>
          <h2 className="text-3xl font-black tracking-tight mb-2">Portal Login</h2>
          <p className="text-sm text-muted-foreground mb-10">Sign in with your assigned credentials.</p>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                Username
              </Label>
              <div className="relative">
                <UserIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="username"
                  data-testid="login-username-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  required
                  autoComplete="username"
                  className="pl-10 h-12 rounded-sm bg-input border-border focus-visible:ring-primary"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  data-testid="login-password-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="pl-10 h-12 rounded-sm bg-input border-border focus-visible:ring-primary"
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-400 border border-red-900/50 bg-red-950/30 px-4 py-3 rounded-sm" data-testid="login-error">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={loading}
              data-testid="login-submit-button"
              className="w-full h-12 rounded-sm font-bold tracking-wide text-base active:scale-[0.98] transition-transform"
            >
              {loading ? "Authenticating..." : "Sign In"}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-8 text-center">
            Session expires automatically after 8 hours of inactivity.
          </p>
        </div>
      </div>
    </div>
  );
}
