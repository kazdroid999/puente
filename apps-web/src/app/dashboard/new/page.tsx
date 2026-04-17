import NewProjectForm from './NewProjectForm';

export default function NewProject() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-3xl font-bold">新規企画投稿</h1>
      <p className="mt-3 text-muted">
        アイディア・業務内容・欲しい機能を書き出してください。AIが事業計画・BEP・技術スタックを自動生成し、
        Puente 承認のうえ 3 日でローンチします。
      </p>
      <NewProjectForm />
    </div>
  );
}
