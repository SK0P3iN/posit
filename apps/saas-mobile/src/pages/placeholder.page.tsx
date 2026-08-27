import { FC } from 'react';

export const PlaceholderPage: FC<{ title: string; description: string }> = ({
  title,
  description,
}) => {
  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-fifth text-sm mt-2">{description}</p>
    </div>
  );
};
