import { useState } from 'react';
import { parseMoney } from '@settlement/domain/money';
import type { Brand } from '../../lib/api';
import { api, okSchema } from '../../lib/api';
import { amountInput, money } from '../../lib/format';
import { Alert, ErrorMessage, Spinner } from '../../components/ui';
import type { Order } from './contracts';

export function OrderRow({
  item,
  brands,
  onSaved,
  onEdit,
}: {
  item: Order;
  brands: Brand[];
  onSaved: () => void;
  onEdit: () => void;
}) {
  const [brandId, setBrandId] = useState(item.brandId);
  const [sales, setSales] = useState(amountInput(item.salesOverride));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dirty =
    brandId !== item.brandId || sales !== amountInput(item.salesOverride);
  async function save() {
    setPending(true);
    setError('');
    try {
      await api(
        '/manage/business/orders/' + encodeURIComponent(item.id),
        okSchema,
        {
          method: 'PUT',
          body: {
            revision: item.revision,
            brandId,
            quantity: item.quantity,
            partialQuantity: item.partialQuantity,
            salesOverride: sales.trim() ? parseMoney(sales) : null,
            costPerPiece: item.costPerPiece,
          },
        },
      );
      onSaved();
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <tr>
      <td>{item.orderDate}</td>
      <td className="order-id">
        {item.id}
        {item.courier === 'pathao' ? (
          <small className="muted">Pathao</small>
        ) : null}
      </td>
      <td className="numeric">{money(item.ads)}</td>
      <td>
        <select
          aria-label={`Brand for ${item.id}`}
          value={brandId}
          disabled={pending}
          onChange={(event) => {
            setBrandId(event.target.value);
            setError('');
          }}
        >
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          aria-label={`Sales amount for ${item.id}`}
          inputMode="decimal"
          value={sales}
          placeholder={amountInput(item.collectedAmount ?? item.codAmount)}
          disabled={pending || item.courier === 'pathao'}
          title={
            item.courier === 'pathao'
              ? 'Pathao revenue uses the courier’s collected amount.'
              : undefined
          }
          onChange={(event) => {
            setSales(event.target.value);
            setError('');
          }}
        />
      </td>
      <td>
        <span className="order-status">{item.status}</span>
      </td>
      <td>{item.deliveryDate ?? '—'}</td>
      <td className="numeric">
        {money(item.codAmount)}
        {item.collectedAmount !== null ? (
          <small className="muted">
            Collected {money(item.collectedAmount)}
          </small>
        ) : null}
      </td>
      <td className="numeric">{money(item.shipping)}</td>
      <td className="numeric">{money(item.codCharge)}</td>
      <td className="numeric">
        {item.status === 'Delivered'
          ? item.costPerPiece === null
            ? 'Missing making cost'
            : money(item.costPerPiece * item.quantity)
          : money(0)}
      </td>
      <td>
        <div className="order-row-actions">
          {dirty ? (
            <>
              <button
                className="primary compact"
                disabled={pending}
                onClick={() => {
                  save().catch((reason: unknown) => {
                    setError(ErrorMessage(reason));
                  });
                }}
              >
                {pending ? (
                  <>
                    <Spinner size={12} /> Saving…
                  </>
                ) : (
                  'Save changes'
                )}
              </button>
              <button
                className="secondary compact"
                disabled={pending}
                onClick={() => {
                  setBrandId(item.brandId);
                  setSales(amountInput(item.salesOverride));
                  setError('');
                }}
              >
                Cancel changes
              </button>
            </>
          ) : (
            <button className="secondary compact" onClick={onEdit}>
              Edit order
            </button>
          )}
        </div>
        {error ? <Alert>{error}</Alert> : null}
      </td>
    </tr>
  );
}
