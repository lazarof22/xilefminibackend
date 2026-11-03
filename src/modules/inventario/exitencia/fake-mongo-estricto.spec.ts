import { Types } from 'mongoose';
import { FakeModel } from './fake-mongo-spec';

/**
 * El modelo falso de las pruebas de la Fase 1 debe comportarse como MongoDB con
 * los campos de id de este proyecto (`Mixed` en Mongoose 9): un ObjectId nunca
 * es igual a su texto, salvo en `_id`, que Mongoose sí convierte.
 */
describe('FakeModel — ids estrictos', () => {
  const P = new Types.ObjectId();
  const C = new Types.ObjectId();

  const modelo = () =>
    new FakeModel([{ producto: P, contenedor: C, cantidad: 4 }]);

  it('un filtro con ObjectId encuentra la fila', async () => {
    expect(
      await modelo().findOne({ producto: P, contenedor: C }),
    ).toMatchObject({ cantidad: 4 });
  });

  it('un filtro con el id en texto NO encuentra la fila (como en la base real)', async () => {
    const m = modelo();

    expect(await m.findOne({ producto: String(P) })).toBeNull();
    expect(await m.find({ producto: { $in: [String(P)] } })).toHaveLength(0);
    expect(await m.find({ producto: { $ne: String(P) } })).toHaveLength(1);
  });

  it('un update condicionado con el id en texto no modifica nada', async () => {
    const m = modelo();

    const r = await m.updateOne(
      { producto: String(P), contenedor: C },
      { $inc: { cantidad: -1 } },
    );

    expect(r.matchedCount).toBe(0);
    expect(m.docs[0].cantidad).toBe(4);
  });

  it('un upsert con el id en texto crea otra fila en vez de tocar la existente', async () => {
    const m = modelo();

    await m.updateOne(
      { producto: String(P), contenedor: C },
      { $inc: { cantidad: 1 } },
      { upsert: true },
    );

    expect(m.docs).toHaveLength(2);
    expect(m.docs[0].cantidad).toBe(4);
  });

  it('el _id sí se acepta en texto (Mongoose lo convierte)', async () => {
    const m = modelo();
    const id = String(m.docs[0]._id);

    expect(await m.findById(id)).toMatchObject({ cantidad: 4 });
    expect(await m.find({ _id: { $in: [id] } })).toHaveLength(1);
  });

  it('aggregate tampoco convierte texto a ObjectId', async () => {
    const m = modelo();

    expect(
      await m.aggregate([
        { $match: { producto: String(P) } },
        { $group: { _id: null, total: { $sum: '$cantidad' } } },
      ]),
    ).toEqual([]);
    expect(
      await m.aggregate([
        { $match: { producto: P } },
        { $group: { _id: null, total: { $sum: '$cantidad' } } },
      ]),
    ).toEqual([{ _id: null, total: 4 }]);
  });
});
