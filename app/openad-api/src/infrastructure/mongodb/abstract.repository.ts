import { Document, Model, UpdateQuery } from 'mongoose';

export abstract class AbstractRepository<T extends Document> {
  protected constructor(protected readonly model: Model<T>) {}

  async create(doc: Partial<T>): Promise<T> {
    const created = new this.model(doc);
    return created.save();
  }

  async findOne(filter: Record<string, unknown>): Promise<T | null> {
    return this.model.findOne(filter).exec();
  }

  async findMany(
    filter: Record<string, unknown>,
    options?: { limit?: number; skip?: number; sort?: Record<string, 1 | -1> }
  ): Promise<T[]> {
    let q = this.model.find(filter);
    if (options?.sort) q = q.sort(options.sort);
    if (options?.skip) q = q.skip(options.skip);
    if (options?.limit) q = q.limit(options.limit);
    return q.exec();
  }

  async updateOne(
    filter: Record<string, unknown>,
    update: UpdateQuery<T>
  ): Promise<T | null> {
    return this.model
      .findOneAndUpdate(filter, update, { new: true })
      .exec();
  }

  async upsert(filter: Record<string, unknown>, doc: Partial<T>): Promise<T> {
    return this.model
      .findOneAndUpdate(filter, doc as UpdateQuery<T>, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      })
      .exec() as Promise<T>;
  }

  async deleteOne(filter: Record<string, unknown>): Promise<boolean> {
    const r = await this.model.deleteOne(filter).exec();
    return r.deletedCount > 0;
  }
}
