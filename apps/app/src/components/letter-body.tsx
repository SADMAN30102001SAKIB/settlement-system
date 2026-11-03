import type { ReactNode } from 'react';
import type { LetterDocument } from '../../shared/letter';
import '@fontsource-variable/noto-sans-bengali';
export function LetterBody({ body }: { body: LetterDocument }) {
  return (
    <div className="letter-body">
      {body.content.map((paragraph, index) => (
        <p key={index}>
          {paragraph.content.length ? (
            paragraph.content.map((node, i) => {
              if (node.type === 'hardBreak') return <br key={i} />;
              let content: ReactNode = node.text;
              for (const mark of node.marks) {
                if (mark.type === 'textStyle')
                  content = (
                    <span
                      style={{
                        color: mark.attrs.color ?? undefined,
                        backgroundColor:
                          mark.attrs.backgroundColor ?? undefined,
                      }}
                    >
                      {content}
                    </span>
                  );
                else if (mark.type === 'bold')
                  content = <strong>{content}</strong>;
                else if (mark.type === 'italic') content = <em>{content}</em>;
                else if (mark.type === 'underline') content = <u>{content}</u>;
                else content = <s>{content}</s>;
              }
              return <span key={i}>{content}</span>;
            })
          ) : (
            <br />
          )}
        </p>
      ))}
    </div>
  );
}
