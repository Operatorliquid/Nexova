import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';

type Step = 'profile' | 'complete';

const COMMERCE_TOOLS = ['products', 'stock', 'orders', 'customers', 'payments'];
const API_URL = import.meta.env.VITE_API_URL || '';

const fetchWithCredentials = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, {
    ...init,
    credentials: 'include',
  });

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, workspace, refreshUser } = useAuth();

  const [currentStep, setCurrentStep] = useState<Step>('profile');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState({
    firstName: user?.firstName || '',
  });

  useEffect(() => {
    if (user?.firstName) {
      setProfile({ firstName: user.firstName });
    }
  }, [user]);

  async function handleProfileSubmit() {
    if (!profile.firstName.trim()) {
      setError('Completa tu nombre');
      return;
    }

    if (!workspace?.id) {
      setError('Error de configuracion. Intenta recargar la pagina.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const profileResponse = await fetchWithCredentials(`${API_URL}/api/v1/auth/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ firstName: profile.firstName.trim() }),
      });

      if (!profileResponse.ok) {
        throw new Error('Error al actualizar perfil');
      }

      const workspaceResponse = await fetchWithCredentials(
        `${API_URL}/api/v1/workspaces/${workspace.id}/settings`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Workspace-Id': workspace.id,
          },
          body: JSON.stringify({
            businessType: 'commerce',
            tools: COMMERCE_TOOLS,
          }),
        }
      );

      if (!workspaceResponse.ok) {
        const errorData = await workspaceResponse.json().catch(() => ({}));
        throw new Error(errorData.message || `Error ${workspaceResponse.status}: No se pudo guardar`);
      }

      await refreshUser();
      setCurrentStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setIsLoading(false);
    }
  }

  function handleComplete() {
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/30 rounded-full blur-[150px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#4236c4]/20 rounded-full blur-[150px]" />
      </div>

      <div className="max-w-2xl mx-auto pt-10">
        <div className="flex justify-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <span className="text-white font-bold text-xl">N</span>
          </div>
        </div>

        {currentStep !== 'complete' && (
          <div className="flex items-center justify-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium bg-primary text-white">
              1
            </div>
          </div>
        )}

        <div className="glass-card rounded-2xl overflow-hidden">
          {currentStep === 'profile' && (
            <>
              <div className="p-8 border-b border-border">
                <h2 className="text-xl font-semibold text-foreground">Completa tu perfil</h2>
                <p className="text-muted-foreground mt-1">
                  Solo necesitamos tu nombre para terminar la configuracion
                </p>
              </div>
              <div className="p-8 space-y-4">
                <Input
                  label="Nombre"
                  value={profile.firstName}
                  onChange={(e) => setProfile({ firstName: e.target.value })}
                  placeholder="Mi negocio"
                />

                {error && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <Button onClick={handleProfileSubmit} className="w-full" isLoading={isLoading}>
                  Continuar
                </Button>
              </div>
            </>
          )}

          {currentStep === 'complete' && (
            <>
              <div className="p-8 text-center border-b border-border">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <h2 className="text-2xl font-semibold text-foreground">Todo listo!</h2>
                <p className="text-muted-foreground mt-1">
                  Tu negocio quedo configurado como comercio.
                </p>
              </div>
              <div className="p-8">
                <Button onClick={handleComplete} className="w-full">
                  Ir al Dashboard
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
