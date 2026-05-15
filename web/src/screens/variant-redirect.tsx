import { Navigate, useParams } from 'react-router-dom';
import { useLive } from '../hooks/use-live';
import { db } from '../db/db';

export function VariantRedirectScreen(): JSX.Element {
  const { variantId } = useParams<{ variantId: string }>();
  const variant = useLive(
    async () => (variantId ? await db.variants.get(variantId) : undefined),
    [variantId],
  );

  if (variant === undefined) return <div />;
  if (!variant) return <Navigate to="/products" replace />;

  return (
    <Navigate
      to={`/article/${variant.article_id}`}
      state={{ highlightVariantId: variantId }}
      replace
    />
  );
}
