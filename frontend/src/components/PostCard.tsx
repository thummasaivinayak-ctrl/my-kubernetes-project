import { Link } from 'react-router-dom';
import { getAvatarColor, getInitial, timeAgo } from '../lib/utils';

interface PostCardProps {
  id: string;
  title: string;
  content: string;
  authorName: string;
  createdAt: string;
}

function PostCard({ id, title, content, authorName, createdAt }: PostCardProps) {
  const excerpt = content.length > 200 ? content.substring(0, 200) + '...' : content;

  return (
    <div className="post-card">
      <div className="post-card-header">
        <span
          className="avatar avatar-md"
          style={{ background: getAvatarColor(authorName) }}
        >
          {getInitial(authorName)}
        </span>
        <div className="post-card-header-info">
          <span className="author-name">{authorName}</span>
          <span className="post-time">{timeAgo(createdAt)}</span>
        </div>
      </div>
      <div className="post-card-body">
        <h2>
          <Link to={`/posts/${id}`}>{title}</Link>
        </h2>
        <div className="excerpt">{excerpt}</div>
      </div>
      <div className="post-card-footer">
        <Link to={`/posts/${id}`} className="read-more">
          Read more
        </Link>
      </div>
    </div>
  );
}

export default PostCard;
