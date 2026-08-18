import Fuse from "fuse.js";
import { AWS_SERVICES, type AwsService } from "../shared/awsServices";

export function searchAwsServices(
  query: string,
  services: readonly AwsService[] = AWS_SERVICES,
): AwsService[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [...services];
  }
  const fuse = new Fuse([...services], {
    keys: ["id", "name"],
    threshold: 0.4,
    ignoreLocation: true,
  });
  return fuse.search(trimmed).map((result) => result.item);
}
