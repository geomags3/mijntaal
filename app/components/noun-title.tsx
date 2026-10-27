'use client';
import { useEffect, useState } from 'react';
import { localLookup } from '../../lib/local-dictionary';
import { nounArticle, nounParts } from '../../lib/noun-article';
export default function NounTitle({
  title,
  body = {},
  infer = false,
}: {
  title: string;
  body?: Record<string, any>;
  infer?: boolean;
}) {
  const parts = nounParts(title, body),
    [inferred, setInferred] = useState('');
  useEffect(() => {
    let active = true;
    setInferred('');
    if (
      infer &&
      !parts.article &&
      /^\S+$/u.test(title.trim()) &&
      (!body.partOfSpeech || body.partOfSpeech === 'noun')
    )
      void localLookup(title)
        .then((entry) => {
          if (active) setInferred(nounArticle(title, entry, body.lemma || ''));
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [title, body.article, body.lemma, body.partOfSpeech, infer]);
  const article = parts.article || inferred;
  return (
    <>
      {article && (
        <>
          <span className={'noun-article noun-article-' + article}>{article}</span>{' '}
        </>
      )}
      {parts.word}
    </>
  );
}
