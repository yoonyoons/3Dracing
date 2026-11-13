import { usePath } from './router';
import { Home } from './pages/Home';
import { Solo } from './pages/Solo';
import { Host } from './pages/Host';
import { Play } from './pages/Play';

export function App() {
  const path = usePath();
  if (path.startsWith('/solo')) return <Solo />;
  if (path.startsWith('/host')) return <Host />;
  if (path.startsWith('/play')) return <Play />;
  return <Home />;
}
