import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Input } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [formData, setFormData] = useState({
    firstName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!formData.firstName.trim()) {
      setError('El nombre es obligatorio');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Las contrasenas no coinciden');
      return;
    }

    if (formData.password.length < 8) {
      setError('La contrasena debe tener al menos 8 caracteres');
      return;
    }

    setIsLoading(true);

    try {
      await register({
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName.trim(),
      });
      // Redirect to onboarding after registration
      navigate('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrarse');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/30 rounded-full blur-[150px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#4236c4]/20 rounded-full blur-[150px]" />
      </div>

      <div className="glass-card rounded-2xl w-full max-w-md overflow-hidden">
        <div className="p-8 text-center border-b border-border">
          <div className="flex justify-center mb-4">
            <img
              src="/brand/logo-light.svg"
              alt="Nexova"
              className="h-10 w-auto block dark:hidden"
            />
            <img
              src="/brand/logo-dark.svg"
              alt="Nexova"
              className="h-10 w-auto hidden dark:block"
            />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Crear cuenta</h1>
          <p className="text-muted-foreground mt-1">
            Registrate para comenzar a usar Nexova
          </p>
        </div>
        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              name="firstName"
              label="Nombre"
              placeholder="Mi negocio"
              value={formData.firstName}
              onChange={handleChange}
              required
            />

            <Input
              type="email"
              name="email"
              label="Email"
              placeholder="tu@email.com"
              value={formData.email}
              onChange={handleChange}
              required
            />

            <Input
              type="password"
              name="password"
              label="Contrasena"
              placeholder="••••••••"
              value={formData.password}
              onChange={handleChange}
              required
              hint="Minimo 8 caracteres"
            />

            <Input
              type="password"
              name="confirmPassword"
              label="Confirmar contrasena"
              placeholder="••••••••"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
            />

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" isLoading={isLoading}>
              Crear cuenta
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Ya tenes cuenta?{' '}
              <Link to="/login" className="text-primary hover:text-primary/80 transition-colors">
                Inicia sesion
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
