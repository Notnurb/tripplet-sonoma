import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding database...');

    // Create test user
    const passwordHash = await bcrypt.hash('password123', 12);

    const user = await prisma.user.upsert({
        where: { email: 'test@hefai.app' },
        update: {},
        create: {
            email: 'test@hefai.app',
            passwordHash,
            name: 'Test User'
        }
    });

    console.log('Created user:', user.email);

    // Create sample conversation
    const conversation = await prisma.conversation.create({
        data: {
            userId: user.id,
            title: 'Welcome to Hefai',
            model: 'taipei4',
            messages: {
                create: [
                    {
                        role: 'user',
                        content: 'Hello, how are you?'
                    },
                    {
                        role: 'assistant',
                        content: "I'm doing great! How can I help you today?"
                    }
                ]
            }
        }
    });

    console.log('Created conversation:', conversation.id);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
