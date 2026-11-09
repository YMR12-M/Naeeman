/**
 * وضع «المحل هو السيرفر»: عناوين الواي فاي اللي التابلت والتلفزيون والكشك
 * بيفتحوها (مش `app://` بتاع برنامج الكمبيوتر ولا localhost).
 * `GET /hub` للمالك بس؛ برّه وضع المحل بيرجّع enabled=false.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api.js';
import { useAuth } from '../context/AuthContext.jsx';

export function useHub() {
  const { can } = useAuth();
  return useQuery({
    queryKey: ['hub'],
    queryFn: () => api.get('/hub'),
    enabled: can('hub.manage'),
    staleTime: 60_000,
    retry: false,
  });
}

/** «http://192.168.1.10:4030» أو null لو مش وضع المحل أو الكمبيوتر مش على شبكة */
export function lanOrigin(hub, port) {
  const address = hub?.enabled ? hub.addresses?.[0]?.address : null;
  return address && port ? `http://${address}:${port}` : null;
}

/** العنوان اللي جهاز تاني يفتحه: واي فاي المحل لو وضع المحل، وإلا عنوان اللوحة نفسه */
export const deviceOrigin = (hub) => lanOrigin(hub, hub?.api_port) ?? window.location.origin;

/** عنوان تطبيق الزبون للي على واي فاي المحل (أو null) */
export const customerOrigin = (hub) => lanOrigin(hub, hub?.customer_port);
