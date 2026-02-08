import { Link } from 'react-router-dom';

interface PostCardProps {
  id: string;
  title: string;
  content: string;
  authorName: string;
  createdAt: string;
}

function PostCard({ id, title, content, authorName, createdAt }: PostCardProps) {
  const excerpt = content.length > 200 ? content.substring(0, 200) + '...' : content;
  const date = new Date(createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="post-card">
      <h2>
        <Link to={`/posts/${id}`}>{title}</Link>
      </h2>
      <div className="meta">
        By {authorName} on {date}
      </div>
      <div className="excerpt">{excerpt}</div>
    </div>
  );
}

export default PostCard;
